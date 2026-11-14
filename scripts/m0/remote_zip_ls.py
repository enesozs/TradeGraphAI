"""List a remote zip's members using HTTP range requests (reads only the central directory)."""
import io, sys, urllib.request, zipfile

class RangeFile:
    def __init__(self, url):
        self.url, self.pos, self.fetched = url, 0, 0
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=30) as r:
            self.size = int(r.headers["Content-Length"])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]; return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        end = min(self.pos + n, self.size) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
        self.pos += len(data); self.fetched += len(data); return data

url = sys.argv[1]
f = RangeFile(url)
z = zipfile.ZipFile(f)
for i in z.infolist():
    print(f"{i.filename}\t{i.compress_size}\t{i.file_size}")
print(f"# archive bytes: {f.size}; bytes fetched to list: {f.fetched}", file=sys.stderr)

# Optional: extract named members to an output dir: remote_zip_ls.py URL OUTDIR member1 member2 ...
if len(sys.argv) > 3:
    import hashlib, pathlib
    out = pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[3:]:
        data = z.read(name)
        (out / name).write_bytes(data)
        print(f"extracted {name} {len(data)} bytes sha256={hashlib.sha256(data).hexdigest()}", file=sys.stderr)
    print(f"# total bytes fetched: {f.fetched}", file=sys.stderr)
