"""Remote-zip reading against an in-memory zip (no network)."""

import hashlib
import io
import zipfile

import pytest

from tradegraph.ingestion.remote_zip import RemoteZipError, extract_member, list_members

PAYLOAD = b"t,i,j,k,v,q\n" + b"2023,4,8,090111,1.5,0.2\n" * 5000


def make_zip(method=zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=method) as z:
        z.writestr("Readme.txt", b"hello")
        z.writestr("BACI_HS12_Y2023_V202601.csv", PAYLOAD)
    return buf.getvalue()


def fetcher(blob: bytes):
    return lambda start, end: blob[start : end + 1]


def chunks(blob: bytes, start: int, size: int = 777):
    for i in range(start, len(blob), size):
        yield blob[i : i + size]


@pytest.mark.parametrize("method", [zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED])
def test_list_and_extract(tmp_path, method):
    blob = make_zip(method)
    members = list_members(fetcher(blob), len(blob))
    assert set(members) == {"Readme.txt", "BACI_HS12_Y2023_V202601.csv"}
    info = members["BACI_HS12_Y2023_V202601.csv"]
    dest = tmp_path / "out.csv"
    sha = extract_member(info, chunks(blob, info.header_offset), dest)
    assert dest.read_bytes() == PAYLOAD
    assert sha == hashlib.sha256(PAYLOAD).hexdigest()
    assert not (tmp_path / "out.csv.part").exists()


def test_corruption_detected(tmp_path):
    blob = bytearray(make_zip(zipfile.ZIP_STORED))
    info = list_members(fetcher(bytes(blob)), len(blob))["BACI_HS12_Y2023_V202601.csv"]
    data_start = info.header_offset + 30 + len(info.filename) + 0
    blob[data_start + 100] ^= 0xFF  # flip one byte inside the stored data
    with pytest.raises(RemoteZipError, match="CRC"):
        extract_member(info, chunks(bytes(blob), info.header_offset), tmp_path / "x.csv")
    assert not (tmp_path / "x.csv").exists()


def test_truncated_download(tmp_path):
    blob = make_zip()
    info = list_members(fetcher(blob), len(blob))["BACI_HS12_Y2023_V202601.csv"]
    short = blob[: info.header_offset + 200]
    with pytest.raises(RemoteZipError):
        extract_member(info, chunks(short, info.header_offset), tmp_path / "x.csv")
