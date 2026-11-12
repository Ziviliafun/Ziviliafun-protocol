"""Asset preparation: reads every file in brand/ and reference/, reports header facts,
derives the palette, writes resized logo files (premultiplied), the traced favicon,
and src/assets/palette.json (provenance for every colour literal in tokens.css).

Run once (or after logos change):  python scripts/assets.py
Requires: Pillow, numpy, opencv-python.
"""
import glob, json, os, struct, sys
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
OUT = "src/assets"
os.makedirs(OUT, exist_ok=True)

TRANSPARENT = "brand/LOGO ZIVILIA PNG...png"      # RGBA, colour type 6
OPAQUE = "brand/LOGO ZIVILIA PNG.png"             # RGB, colour type 2
report = []


def hexs(p):
    return "#%02x%02x%02x" % tuple(int(v) for v in p)


def kmeans(X, k, iters=30):
    C = X[np.linspace(0, len(X) - 1, k).astype(int)].copy()
    for _ in range(iters):
        L = ((X[:, None] - C[None]) ** 2).sum(-1).argmin(1)
        C = np.array([X[L == i].mean(0) if (L == i).any() else C[i] for i in range(k)])
    return C, L


# 1. read every byte-level header + alpha histogram
for f in sorted(glob.glob("brand/*") + glob.glob("reference/*")):
    b = open(f, "rb").read()
    row = {"file": f, "bytes": len(b)}
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        w, h, bd, ct = struct.unpack(">IIBB", b[16:26])
        row.update(ihdr={"w": w, "h": h, "bitDepth": bd, "colourType": ct})
    im = Image.open(f)
    a = np.array(im.convert("RGBA"))[..., 3]
    row.update(mode=im.mode, size=im.size,
               alpha={"zero": int((a == 0).sum()), "partial": int(((a > 0) & (a < 255)).sum()), "full": int((a == 255).sum())})
    report.append(row)
    print(json.dumps(row))

# 2. palette: k-means on the opaque logo, snapped to a real pixel coordinate
palette = {}
src = np.array(Image.open(OPAQUE).convert("RGB"))
step = 8
s = src[::step, ::step]
H, W = s.shape[:2]
X = s.reshape(-1, 3).astype(float)
C, L = kmeans(X, 7)
cnt = np.bincount(L, minlength=7)
names = ["bg", "panel", "deep", "violet", "ink", "accent", "hairline"]
rank = sorted(range(7), key=lambda i: -cnt[i])
items = []
for i in rank:
    d = ((X - C[i]) ** 2).sum(1)
    d[L != i] = 1e18
    j = int(d.argmin())
    y, x = divmod(j, W)
    items.append({"hex": hexs(X[j]), "x": x * step, "y": y * step, "share": round(cnt[i] / len(X), 4)})
palette["logoOpaque"] = {"file": OPAQUE, "method": "k-means k=7 on stride-8 grid, centroid snapped to nearest real pixel", "colours": items}

ban = np.array(Image.open("reference/SAMPUL ZIVILIA JPG.jpg.jpeg").convert("RGB")).astype(int)
r, g, b_ = ban[..., 0], ban[..., 1], ban[..., 2]
m = (g > r + 50) & (g > b_ + 20)
px = ban[m]; ys, xs = np.where(m)
j = int(((px - np.median(px, 0)) ** 2).sum(1).argmin())
green = {"hex": hexs(px[j]), "x": int(xs[j]), "y": int(ys[j]), "method": "median of green-arrow pixels, snapped to real pixel"}
bc, bl = kmeans(ban[::6, ::6].reshape(-1, 3).astype(float), 7)
bx = ban[::6, ::6].reshape(-1, 3).astype(float)
bW = ban[::6, ::6].shape[1]
bitems = []
for i in range(7):
    d = ((bx - bc[i]) ** 2).sum(1); d[bl != i] = 1e18
    jj = int(d.argmin()); yy, xx = divmod(jj, bW)
    bitems.append({"hex": hexs(bx[jj]), "x": xx * 6, "y": yy * 6})
palette["banner"] = {"file": "reference/SAMPUL ZIVILIA JPG.jpg.jpeg", "colours": bitems, "green": green}
json.dump(palette, open(f"{OUT}/palette.json", "w"), indent=1)
print("palette ->", json.dumps(palette["logoOpaque"]["colours"]))
print("green", green)

# 3. premultiplied resize of the transparent mark (pure-black transparent regions found)
rgba = np.array(Image.open(TRANSPARENT).convert("RGBA")).astype(np.float32)
a = rgba[..., 3]
ys, xs = np.where(a > 8)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
pad = int(0.06 * max(x1 - x0, y1 - y0))
x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
x1, y1 = min(rgba.shape[1], x1 + pad), min(rgba.shape[0], y1 + pad)
crop = rgba[y0:y1, x0:x1]
print("mark bbox", (int(x0), int(y0), int(x1), int(y1)))


def premul_resize(arr, w):
    h = round(arr.shape[0] * w / arr.shape[1])
    al = arr[..., 3:4] / 255.0
    pm = np.concatenate([arr[..., :3] * al, arr[..., 3:4]], -1)
    out = cv2.resize(pm, (w, h), interpolation=cv2.INTER_AREA)
    oa = out[..., 3:4] / 255.0
    rgb = np.where(oa > 0, out[..., :3] / np.maximum(oa, 1e-6), 0)
    return Image.fromarray(np.clip(np.concatenate([rgb, out[..., 3:4]], -1), 0, 255).astype(np.uint8), "RGBA")


premul_resize(crop, 512).save(f"{OUT}/logo-mark-512.png", optimize=True)
premul_resize(crop, 160).save(f"{OUT}/logo-mark-160.png", optimize=True)
Image.open(OPAQUE).convert("RGB").resize((512, 512), Image.LANCZOS).save(f"{OUT}/brand-512.png", optimize=True)
Image.open(OPAQUE).convert("RGB").resize((180, 180), Image.LANCZOS).save(f"{OUT}/apple-touch-icon.png", optimize=True)

# 4. favicon traced from the real alpha grid
mask = (a > 127).astype(np.uint8)[int(ys.min()):int(ys.max()) + 1, int(xs.min()):int(xs.max()) + 1] * 255
mh, mw = mask.shape
cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
box = 22.0
sc = box / max(mw, mh)
ox, oy = (32 - mw * sc) / 2, (32 - mh * sc) / 2
d = []
for c in cs:
    if cv2.contourArea(c) < 400:
        continue
    ap = cv2.approxPolyDP(c, 2.2, True)[:, 0, :]
    pts = [(ox + p[0] * sc, oy + p[1] * sc) for p in ap]
    d.append("M" + "L".join("%.2f %.2f" % p for p in pts) + "Z")
bg = items[0]["hex"]
fg = [i for i in items if i["hex"].startswith("#fe") or i["hex"].startswith("#fd")][0]["hex"]
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
       f'<rect width="32" height="32" rx="7" fill="{bg}"/>'
       f'<path fill="{fg}" fill-rule="evenodd" d="{"".join(d)}"/></svg>')
assert "--" not in svg
open(f"{OUT}/favicon.svg", "w").write(svg)
print("favicon bytes", len(svg), "subpaths", len(d), "bg", bg, "fg", fg)
json.dump(report, open(f"{OUT}/assets-report.json", "w"), indent=1)
