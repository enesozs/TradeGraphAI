"""Read individual members of a large remote zip using HTTP range requests.

BACI ships all years of a release in one ~1.3 GB zip. Range requests let us list the archive
(a few KB) and fetch one year (~100 MB) without downloading the rest.
"""

from __future__ import annotations

import hashlib
import json
import struct
import urllib.request
import zipfile
import zlib
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path

# fetch_range(start, end_inclusive) -> bytes. Injectable so tests need no network.
RangeFetcher = Callable[[int, int], bytes]
LOCAL_HEADER = struct.Struct("<IHHHHHIIIHH")
LOCAL_HEADER_SIG = 0x04034B50
CHUNK = 1 << 20


class RemoteZipError(RuntimeError):
    pass


def http_size(url: str, timeout: float = 60) -> int:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return int(r.headers["Content-Length"])


def http_range_fetcher(url: str, timeout: float = 300) -> RangeFetcher:
    def fetch(start: int, end: int) -> bytes:
        req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status != 206:
                raise RemoteZipError(f"server ignored range request (HTTP {r.status})")
            return r.read()

    return fetch


def http_range_stream(url: str, start: int, end: int, timeout: float = 300) -> Iterator[bytes]:
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if r.status != 206:
            raise RemoteZipError(f"server ignored range request (HTTP {r.status})")
        while chunk := r.read(CHUNK):
            yield chunk


class _RangeFile:
    """Minimal seekable file object backed by a RangeFetcher (enough for zipfile)."""

    def __init__(self, fetch: RangeFetcher, size: int) -> None:
        self._fetch, self.size, self.pos = fetch, size, 0

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        self.pos = {0: offset, 1: self.pos + offset, 2: self.size + offset}[whence]
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        data = self._fetch(self.pos, min(self.pos + n, self.size) - 1)
        self.pos += len(data)
        return data


def list_members(fetch: RangeFetcher, size: int) -> dict[str, zipfile.ZipInfo]:
    """Return the archive's members, reading only the central directory."""
    with zipfile.ZipFile(_RangeFile(fetch, size)) as z:  # type: ignore[arg-type]
        return {i.filename: i for i in z.infolist()}


def extract_member(
    info: zipfile.ZipInfo,
    chunks: Iterator[bytes],
    dest: Path,
) -> str:
    """Stream-inflate one member to ``dest``; verify size and CRC; return SHA-256 hex.

    ``chunks`` must start at the member's local header (``info.header_offset``) and cover
    at least the header plus the compressed data.
    """
    if info.compress_type not in (zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED):
        raise RemoteZipError(f"unsupported compression {info.compress_type} for {info.filename}")
    buf = b""
    it = iter(chunks)
    while len(buf) < LOCAL_HEADER.size:
        buf += next(it)
    sig, *_, name_len, extra_len = LOCAL_HEADER.unpack(buf[: LOCAL_HEADER.size])
    if sig != LOCAL_HEADER_SIG:
        raise RemoteZipError(f"bad local header for {info.filename}")
    skip = LOCAL_HEADER.size + name_len + extra_len
    while len(buf) < skip:
        buf += next(it)

    remaining = info.compress_size
    inflater = zlib.decompressobj(-15) if info.compress_type == zipfile.ZIP_DEFLATED else None
    crc, written, sha = 0, 0, hashlib.sha256()
    tmp = dest.with_suffix(dest.suffix + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)

    def emit(raw: bytes) -> None:
        nonlocal crc, written
        out = inflater.decompress(raw) if inflater else raw
        crc = zlib.crc32(out, crc)
        written += len(out)
        sha.update(out)
        fh.write(out)

    with tmp.open("wb") as fh:
        first = buf[skip:]
        for piece in _take(first, it, remaining):
            remaining -= len(piece)
            emit(piece)
        if inflater:
            tail = inflater.flush()
            crc, written = zlib.crc32(tail, crc), written + len(tail)
            sha.update(tail)
            fh.write(tail)
    if remaining:
        tmp.unlink(missing_ok=True)
        raise RemoteZipError(f"truncated download for {info.filename}")
    if written != info.file_size or (crc & 0xFFFFFFFF) != info.CRC:
        tmp.unlink(missing_ok=True)
        raise RemoteZipError(f"size/CRC mismatch for {info.filename}")
    tmp.replace(dest)
    return sha.hexdigest()


MAX_HEADER_EXTRA = 65_535 + 512  # upper bound on local-header name + extra fields


def _adopt_existing(dest: Path, info: zipfile.ZipInfo) -> str | None:
    """If ``dest`` already holds this member (size + CRC match), return its SHA-256."""
    if not dest.exists() or dest.stat().st_size != info.file_size:
        return None
    crc, sha = 0, hashlib.sha256()
    with dest.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            crc = zlib.crc32(chunk, crc)
            sha.update(chunk)
    return sha.hexdigest() if (crc & 0xFFFFFFFF) == info.CRC else None


def fetch_members(url: str, wanted: list[str], out: Path, extra: dict, log=print) -> dict[str, dict]:
    """Fetch named members of a remote zip into ``out`` with a SHA-256 manifest.

    Already-verified files are skipped, and existing files whose CRC matches the archive are adopted.
    """
    manifest_path = out / "manifest.json"
    manifest: dict[str, dict] = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    size = http_size(url)
    members = list_members(http_range_fetcher(url), size)
    missing = [w for w in wanted if w not in members]
    if missing:
        raise RemoteZipError(f"not in archive {url}: {missing}")
    for name in wanted:
        info = members[name]
        dest = out / name
        entry = manifest.get(name)
        if entry and dest.exists() and dest.stat().st_size == entry["bytes"]:
            log(f"skip  {name} (already verified)")
            continue
        sha = _adopt_existing(dest, info)
        if sha:
            log(f"adopt {name} (existing file matches archive CRC)")
        else:
            start = info.header_offset
            end = min(start + 30 + MAX_HEADER_EXTRA + info.compress_size, size - 1)
            log(f"fetch {name} ({info.compress_size / 1e6:.0f} MB compressed)")
            sha = extract_member(info, http_range_stream(url, start, end), dest)
        manifest[name] = {
            "bytes": info.file_size,
            "sha256": sha,
            "crc32": f"{info.CRC:08x}",
            "source_url": url,
            "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
            **extra,
        }
        out.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    return manifest


def _take(first: bytes, rest: Iterator[bytes], n: int) -> Iterator[bytes]:
    """Yield exactly ``n`` bytes: ``first`` followed by ``rest``."""
    for chunk in _chain(first, rest):
        if n <= 0:
            return
        piece = chunk[:n]
        n -= len(piece)
        yield piece


def _chain(first: bytes, rest: Iterator[bytes]) -> Iterator[bytes]:
    if first:
        yield first
    yield from rest
