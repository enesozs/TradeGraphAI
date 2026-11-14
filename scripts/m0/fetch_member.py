"""Fetch one member of a remote zip via a single HTTP range request, inflate locally, verify CRC, write + sha256."""
import hashlib, pathlib, struct, subprocess, sys, zipfile, zlib
sys.path.insert(0, ".")
url, outdir, name = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3]
import importlib.util
spec = importlib.util.spec_from_file_location("rz", "remote_zip_ls.py")
# Reuse RangeFile class only (avoid running module main): copy minimal logic
src = open("remote_zip_ls.py").read().split("url = sys.argv[1]")[0]
ns = {}; exec(src, ns)
f = ns["RangeFile"](url)
info = zipfile.ZipFile(f).getinfo(name)
start = info.header_offset
end = start + 30 + len(name.encode()) + 65535 + info.compress_size  # generous upper bound on extra field
end = min(end, f.size - 1)
tmp = outdir / (name + ".part")
outdir.mkdir(parents=True, exist_ok=True)
subprocess.run(["curl", "-sS", "--fail", "-r", f"{start}-{end}", "-o", str(tmp), url], check=True)
raw = tmp.read_bytes()
sig, ver, flag, method, _, _, crc, csize, usize, nlen, xlen = struct.unpack("<IHHHHHIIIHH", raw[:30])
assert sig == 0x04034b50, "bad local header"
data_start = 30 + nlen + xlen
comp = raw[data_start:data_start + info.compress_size]
assert method == 8, f"unexpected compression {method}"
out = zlib.decompressobj(-15).decompress(comp)
assert len(out) == info.file_size, (len(out), info.file_size)
assert zlib.crc32(out) & 0xffffffff == info.CRC, "CRC mismatch"
(outdir / name).write_bytes(out); tmp.unlink()
print(f"{name}\tcompressed={info.compress_size}\tbytes={len(out)}\tcrc=ok\tsha256={hashlib.sha256(out).hexdigest()}")
