#!/usr/bin/env python3
"""Generate PWA icons. Usage: python3 tools/make_icons.py (run from repo root)."""
from PIL import Image, ImageDraw, ImageFont
import os

BG = (17, 17, 17)
RED = (255, 69, 58)
ORANGE = (255, 159, 10)
S = 1024  # supersample canvas


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def draw(scale):
    """scale<1 shrinks artwork toward center (for maskable safe zone)."""
    im = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(im)
    cx = S / 2
    k = scale

    def X(v): return cx + (v - cx) * k
    def Y(v): return cx + (v - cx) * k

    # alarm bell
    d.ellipse([X(262), Y(150), X(762), Y(650)], fill=RED)           # dome
    d.rectangle([X(262), Y(400), X(762), Y(640)], fill=RED)         # body
    d.polygon([(X(200), Y(660)), (X(824), Y(660)), (X(770), Y(560)), (X(254), Y(560))], fill=RED)
    d.rounded_rectangle([X(170), Y(640), X(854), Y(700)], radius=30 * k, fill=ORANGE)  # rim
    d.ellipse([X(442), Y(690), X(582), Y(830)], fill=ORANGE)        # clapper
    d.ellipse([X(472), Y(110), X(552), Y(190)], fill=ORANGE)        # top knob
    # ring marks
    for sx in (-1, 1):
        for r, w in ((400, 26), (450, 22)):
            box = [X(cx - r), Y(cx - r + 80), X(cx + r), Y(cx + r + 80)]
            a0, a1 = (200, 235) if sx < 0 else (305, 340)
            d.arc(box, a0, a1, fill=ORANGE, width=int(w * k))
    # "10"
    f = font(int(300 * k))
    d.text((cx, Y(470)), "10", font=f, fill=BG, anchor="mm")
    return im


def save(im, size, path):
    im.resize((size, size), Image.LANCZOS).save(path, optimize=True)


os.makedirs("icons", exist_ok=True)
std = draw(1.0)
save(std, 192, "icons/icon-192.png")
save(std, 512, "icons/icon-512.png")
save(std, 180, "icons/apple-touch-icon.png")   # iOS rounds corners itself; opaque bg
save(draw(0.72), 512, "icons/icon-maskable-512.png")
print("icons written")
