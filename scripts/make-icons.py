"""Draws the app icons (speech bubble with an "L") as PNG files, using only the standard library.

Run from the repo root:  python scripts/make-icons.py
Writes public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png.
public/icons/icon.svg is the same drawing as vector source (keep both in sync).
The design is our own simple shapes, not a brand logo.
"""
import os
import struct
import zlib

INDIGO = (79, 70, 229, 255)  # #4f46e5 (theme color)
WHITE = (255, 255, 255, 255)
SS = 3  # supersampling per axis (anti-aliasing)


def rrect(px, py, x, y, w, h, r):
    """Point inside a rounded rectangle."""
    if not (x <= px <= x + w and y <= py <= y + h):
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def tri(px, py, a, b, c):
    """Point inside a triangle (sign test)."""
    def side(p, q):
        return (px - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (py - q[1])
    d1, d2, d3 = side(a, b), side(b, c), side(c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def color_at(px, py, maskable, content_scale):
    """Colour of the icon at a point of the 512x512 design space (None = transparent)."""
    inside_bg = True if maskable else rrect(px, py, 0, 0, 512, 512, 112)
    if not inside_bg:
        return None
    # Content (bubble + letter) is scaled around the centre; maskable icons keep it in the safe zone.
    cx = 256 + (px - 256) / content_scale
    cy = 256 + (py - 256) / content_scale
    letter = rrect(cx, cy, 218, 150, 44, 148, 14) or rrect(cx, cy, 218, 254, 120, 44, 14)
    if letter:
        return INDIGO
    bubble = rrect(cx, cy, 92, 100, 328, 240, 68) or tri(cx, cy, (140, 320), (140, 428), (250, 330))
    return WHITE if bubble else INDIGO


def render(size, maskable=False):
    scale = 0.7 if maskable else 1.0
    n = size * SS
    rows = []
    for j in range(size):
        row = bytearray()
        for i in range(size):
            acc = [0, 0, 0, 0]
            for sj in range(SS):
                for si in range(SS):
                    px = (i * SS + si + 0.5) / n * 512
                    py = (j * SS + sj + 0.5) / n * 512
                    c = color_at(px, py, maskable, scale)
                    if c is not None:
                        acc[0] += c[0]
                        acc[1] += c[1]
                        acc[2] += c[2]
                        acc[3] += 255
            total = SS * SS
            a = acc[3]
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                covered = a // 255  # samples that hit a shape
                row += bytes((acc[0] // covered, acc[1] // covered, acc[2] // covered, a // total))
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)
    print(f"{path}  {len(png)} bytes")


if __name__ == "__main__":
    out = os.path.join("public", "icons")
    os.makedirs(out, exist_ok=True)
    for name, size, maskable in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("maskable-512.png", 512, True),
        # iOS draws its own rounded mask, so the touch icon is full-bleed.
        ("apple-touch-icon.png", 180, True),
    ]:
        write_png(os.path.join(out, name), render(size, maskable), size)
