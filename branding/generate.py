#!/usr/bin/env python3
"""
Every picture Veil OS needs, made from the three source images.

The sources are the same files the browser ships: the mark on its dark tile,
and the mark and the wordmark in white on transparent. Everything else - the
boot animation's frames, the GRUB background, the wallpapers, the icon theme's
logo at every size - is derived here, so changing the logo means changing
three files and running this once.

Pillow only, so it runs the same on a developer's machine and in CI.

    python3 branding/generate.py            # writes into branding/out/
    python3 branding/generate.py --preview  # also writes a contact sheet
    python3 branding/generate.py --icons    # only the logos and app icons
"""

import math
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source')
OUT = os.path.join(HERE, 'out')

# The browser's palette, so the OS and the browser look like one thing.
BG = (11, 14, 19)            # #0b0e13
BG_2 = (19, 27, 38)          # #131b26
ACCENT = (125, 211, 160)     # #7dd3a0
ACCENT_DEEP = (46, 128, 96)
INK = (230, 235, 242)
MUTED = (125, 138, 153)


def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGBA')


def save(img, *parts):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def trimmed(img):
    """The image cropped to what is actually drawn."""
    box = img.getbbox()
    return img.crop(box) if box else img


def fit(img, size):
    """Scale to fit a square of `size`, centred, on transparent."""
    img = trimmed(img)
    w, h = img.size
    scale = size / max(w, h)
    img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
    return canvas


def tint(img, colour):
    """A white-on-transparent image, recoloured, keeping its alpha."""
    solid = Image.new('RGBA', img.size, colour + (255,))
    solid.putalpha(img.getchannel('A'))
    return solid


def vertical_gradient(size, top, bottom):
    w, h = size
    grad = Image.new('RGB', (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return grad.resize((w, h))


def radial_glow(size, colour, strength=1.0, falloff=2.2):
    """A soft circular glow, bright in the middle and gone at the edge."""
    w, h = size
    small = 256
    img = Image.new('L', (small, small), 0)
    px = img.load()
    c = (small - 1) / 2
    for y in range(small):
        for x in range(small):
            d = math.hypot(x - c, y - c) / c
            v = max(0.0, 1.0 - d) ** falloff * strength
            px[x, y] = min(255, round(v * 255))
    alpha = img.resize((w, h), Image.BICUBIC)
    glow = Image.new('RGBA', (w, h), colour + (0,))
    glow.putalpha(alpha)
    return glow


def noise(size, amount=6, seed=7):
    """Faint grain, so a large dark gradient does not band on a cheap panel."""
    rnd = random.Random(seed)
    w, h = size
    tile = Image.new('L', (256, 256))
    tile.putdata([128 + rnd.randint(-amount, amount) for _ in range(256 * 256)])
    out = Image.new('L', (w, h))
    for y in range(0, h, 256):
        for x in range(0, w, 256):
            out.paste(tile, (x, y))
    return out


def with_grain(img, amount=5):
    grain = noise(img.size, amount).convert('RGB')
    return ImageChops.add(img.convert('RGB'), grain, scale=1.0, offset=-128)


# --------------------------------------------------------------------- logos

def logos():
    mark = load('veil-mark.png')
    icon = load('veil-icon.png')
    word = load('veil-word.png')

    # The distributor logo, as the icon theme expects it: every standard size,
    # in both the tile and the bare mark.
    for size in (16, 22, 24, 32, 48, 64, 96, 128, 256, 512):
        save(fit(icon, size), 'icons', 'hicolor', f'{size}x{size}', 'apps', 'veil-os.png')
        save(fit(tint(mark, INK), size), 'icons', 'hicolor', f'{size}x{size}', 'apps', 'veil-os-symbolic-light.png')

    save(fit(icon, 512), 'logo', 'veil-os-logo.png')
    save(fit(tint(mark, INK), 256), 'logo', 'veil-mark-light.png')
    save(fit(tint(mark, BG), 256), 'logo', 'veil-mark-dark.png')
    word_h = round(480 * trimmed(word).height / trimmed(word).width)
    # Light ink for dark backgrounds, dark ink for light ones: GNOME's About
    # page picks between them by theme.
    save(tint(trimmed(word), INK).resize((480, word_h), Image.LANCZOS), 'logo', 'veil-word-light.png')
    save(tint(trimmed(word), BG).resize((480, word_h), Image.LANCZOS), 'logo', 'veil-word-dark.png')

    # The login screen's logo: GDM draws it small, under the user list. The
    # wordmark alone - its V is the mark, so putting the mark beside it as well
    # reads as "V VEIL".
    w = tint(trimmed(word), INK)
    w = w.resize((round(w.width * 40 / w.height), 40), Image.LANCZOS)
    gdm = Image.new('RGBA', (w.width, 48), (0, 0, 0, 0))
    gdm.paste(w, (0, 4), w)
    save(gdm, 'logo', 'gdm-logo.png')


# ----------------------------------------------------------------- app icons

def tile(size):
    """Veil's rounded dark square, the shape every Veil app icon sits on."""
    big = size * 4
    grad = vertical_gradient((big, big), BG_2, BG).convert('RGBA')
    mask = Image.new('L', (big, big), 0)
    inset = round(big * 0.06)
    ImageDraw.Draw(mask).rounded_rectangle([inset, inset, big - inset, big - inset],
                                           radius=round(big * 0.2), fill=255)
    out = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def app_icons():
    """The Store and Appearance: a bag with the mark on it, and three colours."""
    mark = load('veil-mark.png')
    big = 1024 * 4

    # Store.
    store = tile(1024)
    d = ImageDraw.Draw(store)
    body = [round(big * 0.2), round(big * 0.34), round(big * 0.8), round(big * 0.8)]
    handle = [round(big * 0.34), round(big * 0.22), round(big * 0.66), round(big * 0.5)]
    d.rounded_rectangle(body, radius=round(big * 0.07), fill=ACCENT + (255,))
    # A bag's handle is fixed through two holes in its front, which is
    # what tells it apart from a padlock at small sizes.
    d.arc(handle, 180, 360, fill=INK + (255,), width=round(big * 0.03))
    for hx in (handle[0], handle[2]):
        hr = round(big * 0.028)
        hy = round(big * 0.42)
        d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=BG + (255,))
        d.line([hx, round(big * 0.36), hx, hy], fill=INK + (255,), width=round(big * 0.03))
    m = fit(tint(mark, BG), round(big * 0.22))
    store.paste(m, ((big - m.width) // 2, round(big * 0.5)), m)
    store = store.resize((1024, 1024), Image.LANCZOS)

    # Appearance.
    look = tile(1024)
    layer = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    r = round(big * 0.2)
    cx, cy = big // 2, round(big * 0.52)
    for i, colour in enumerate([ACCENT, (91, 155, 248), (171, 71, 188)]):
        a = math.radians(-90 + i * 120)
        x = cx + round(math.cos(a) * big * 0.12)
        y = cy + round(math.sin(a) * big * 0.12)
        disc = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(disc).ellipse([x - r, y - r, x + r, y + r], fill=colour + (215,))
        layer = Image.alpha_composite(layer, disc)
    look = Image.alpha_composite(look, layer).resize((1024, 1024), Image.LANCZOS)

    for size in (16, 22, 24, 32, 48, 64, 96, 128, 256, 512):
        save(store.resize((size, size), Image.LANCZOS), 'icons', 'hicolor', f'{size}x{size}', 'apps', 'veil-store.png')
        save(look.resize((size, size), Image.LANCZOS), 'icons', 'hicolor', f'{size}x{size}', 'apps', 'veil-appearance.png')
    save(store.resize((256, 256), Image.LANCZOS), 'logo', 'veil-store.png')
    save(look.resize((256, 256), Image.LANCZOS), 'logo', 'veil-appearance.png')


# ------------------------------------------------------------ boot animation

def plymouth():
    """
    The frames the boot animation is built from.

    Plymouth's script theme moves and fades whole images, so the animation is
    authored as a handful of layers rather than as a film: the mark, a glow
    that breathes behind it, a ring that turns, and a thin progress line.
    """
    mark = load('veil-mark.png')
    word = load('veil-word.png')
    d = ('plymouth', 'veil')

    save(fit(tint(mark, INK), 160), *d, 'mark.png')

    # A second copy in the accent colour, faded in over the white one as the
    # machine finishes booting.
    save(fit(tint(mark, ACCENT), 160), *d, 'mark-accent.png')

    save(radial_glow((420, 420), ACCENT, strength=0.55, falloff=2.4), *d, 'glow.png')

    # The ring: a quarter arc with a soft tail, turned by the script.
    size, width = 260, 3
    ring = Image.new('RGBA', (size * 4, size * 4), (0, 0, 0, 0))
    dr = ImageDraw.Draw(ring)
    steps = 90
    for i in range(steps):
        a0 = -90 + i * (110 / steps)
        a1 = a0 + (110 / steps) + 0.6
        alpha = round(255 * (i / steps) ** 1.6)
        dr.arc([8, 8, size * 4 - 8, size * 4 - 8], a0, a1, fill=ACCENT + (alpha,), width=width * 4)
    ring = ring.resize((size, size), Image.LANCZOS)
    save(ring, *d, 'ring.png')

    # Turned in advance rather than by the script. Plymouth can rotate an image
    # itself, but doing so fifty times a second on an unaccelerated framebuffer
    # is how a boot splash ends up stuttering on exactly the old machines this
    # is meant to look good on. Sixty frames is a six-degree step - smooth at
    # the speed it turns.
    for i in range(60):
        frame = ring.rotate(-i * 6, resample=Image.BICUBIC)
        save(frame, *d, 'ring', f'ring-{i:02d}.png')

    # A faint full circle under the moving arc, so the ring reads as a ring.
    track = Image.new('RGBA', (size * 4, size * 4), (0, 0, 0, 0))
    ImageDraw.Draw(track).ellipse([8, 8, size * 4 - 8, size * 4 - 8],
                                  outline=INK + (26,), width=width * 4)
    save(track.resize((size, size), Image.LANCZOS), *d, 'ring-track.png')

    w = tint(trimmed(word), INK)
    w = w.resize((round(w.width * 30 / w.height), 30), Image.LANCZOS)
    save(w, *d, 'word.png')

    # The progress line, used while the disk is being checked or unlocked.
    save(Image.new('RGBA', (240, 2), INK + (36,)), *d, 'progress-track.png')
    save(Image.new('RGBA', (240, 2), ACCENT + (255,)), *d, 'progress-fill.png')

    # The password prompt, for an encrypted disk.
    box = Image.new('RGBA', (320, 44), (0, 0, 0, 0))
    ImageDraw.Draw(box).rounded_rectangle([0, 0, 319, 43], radius=12,
                                          fill=(255, 255, 255, 18), outline=INK + (60,), width=1)
    save(box, *d, 'entry.png')
    bullet = Image.new('RGBA', (10, 10), (0, 0, 0, 0))
    ImageDraw.Draw(bullet).ellipse([0, 0, 9, 9], fill=INK + (255,))
    save(bullet, *d, 'bullet.png')
    lock = fit(tint(mark, MUTED), 20)
    save(lock, *d, 'lock.png')


# ---------------------------------------------------------------------- GRUB

def grub():
    w, h = 1920, 1080
    bg = vertical_gradient((w, h), BG_2, BG).convert('RGBA')
    glow = radial_glow((1400, 1400), ACCENT_DEEP, strength=0.28, falloff=2.0)
    bg.alpha_composite(glow, ((w - 1400) // 2, h // 2 - 700 - 120))

    # The wordmark alone: its V is the mark already.
    word = tint(trimmed(load('veil-word.png')), INK)
    word = word.resize((round(word.width * 64 / word.height), 64), Image.LANCZOS)
    bg.alpha_composite(word, ((w - word.width) // 2, 250))

    save(with_grain(bg, 3), 'grub', 'veil', 'background.png')

    # The highlighted entry: a rounded pill, drawn in nine pieces because that
    # is how GRUB stretches a box.
    # GRUB adds the corner pieces' size around the entry, so they are kept
    # small: the theme's item_spacing has to cover twice their height.
    pill = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle([0, 0, 31, 31], radius=8,
                                           fill=ACCENT + (46,), outline=ACCENT + (170,), width=2)
    pieces = {
        'nw': (0, 0, 8, 8), 'n': (8, 0, 24, 8), 'ne': (24, 0, 32, 8),
        'w': (0, 8, 8, 24), 'c': (8, 8, 24, 24), 'e': (24, 8, 32, 24),
        'sw': (0, 24, 8, 32), 's': (8, 24, 24, 32), 'se': (24, 24, 32, 32),
    }
    for name, box in pieces.items():
        save(pill.crop(box), 'grub', 'veil', f'select_{name}.png')


# ---------------------------------------------------------------- wallpapers

def wallpaper_mist(w, h, seed, top, bottom, blobs):
    rnd = random.Random(seed)
    img = vertical_gradient((w, h), top, bottom).convert('RGBA')
    for colour, strength, scale in blobs:
        d = round(max(w, h) * scale)
        g = radial_glow((d, d), colour, strength=strength, falloff=1.8)
        x = rnd.randint(-d // 3, w - d * 2 // 3)
        y = rnd.randint(-d // 3, h - d * 2 // 3)
        img.alpha_composite(g, (x, y))
    return with_grain(img.filter(ImageFilter.GaussianBlur(2)), 3)


def wallpaper_ribbons(w, h, seed, base, colours):
    """Soft bands of light, the kind of abstract a desktop wallpaper wants."""
    rnd = random.Random(seed)
    img = Image.new('RGBA', (w, h), base + (255,))
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    for i, colour in enumerate(colours):
        amp = h * rnd.uniform(0.08, 0.18)
        mid = h * (0.35 + i * 0.12)
        phase = rnd.uniform(0, math.pi * 2)
        freq = rnd.uniform(1.1, 1.8)
        thick = h * rnd.uniform(0.06, 0.12)
        pts_top, pts_bot = [], []
        for x in range(0, w + 40, 40):
            t = x / w
            y = mid + math.sin(t * math.pi * freq + phase) * amp
            pts_top.append((x, y - thick / 2))
            pts_bot.append((x, y + thick / 2))
        dr.polygon(pts_top + pts_bot[::-1], fill=colour + (70,))
    layer = layer.filter(ImageFilter.GaussianBlur(h * 0.035))
    img.alpha_composite(layer)
    return with_grain(img, 3)


def wallpaper_mark(w, h, top, bottom, mark_colour, mark_alpha):
    img = vertical_gradient((w, h), top, bottom).convert('RGBA')
    glow = radial_glow((round(h * 1.2), round(h * 1.2)), ACCENT_DEEP, strength=0.3, falloff=2.0)
    img.alpha_composite(glow, ((w - glow.width) // 2, (h - glow.height) // 2))
    mark = fit(tint(load('veil-mark.png'), mark_colour), round(h * 0.34))
    faded = mark.copy()
    faded.putalpha(mark.getchannel('A').point(lambda a: round(a * mark_alpha)))
    img.alpha_composite(faded, ((w - mark.width) // 2, (h - mark.height) // 2))
    return with_grain(img, 3)


def wallpapers():
    w, h = 3840, 2160
    walls = {
        'veil-night': wallpaper_mist(w, h, 3, BG_2, BG,
                                     [(ACCENT_DEEP, 0.35, 0.9), ((40, 70, 120), 0.3, 0.8)]),
        'veil-dawn': wallpaper_mist(w, h, 11, (238, 242, 247), (214, 226, 236),
                                    [(ACCENT, 0.35, 0.9), ((180, 200, 240), 0.35, 0.8)]),
        'veil-aurora': wallpaper_ribbons(w, h, 5, BG,
                                         [ACCENT, (90, 140, 230), (160, 110, 220)]),
        'veil-tide': wallpaper_ribbons(w, h, 21, (12, 22, 34),
                                       [(60, 180, 200), ACCENT, (40, 90, 160)]),
        'veil-mark': wallpaper_mark(w, h, BG_2, BG, INK, 0.08),
        'veil-mark-light': wallpaper_mark(w, h, (240, 243, 247), (222, 229, 236), BG, 0.07),
    }
    for name, img in walls.items():
        save(img.convert('RGB'), 'wallpapers', name + '.png')
        # A small copy for the picker in Veil Appearance.
        thumb = img.convert('RGB').resize((384, 216), Image.LANCZOS)
        save(thumb, 'wallpapers', 'thumbs', name + '.png')
    return list(walls)


# -------------------------------------------------------------- the installer

def calamares():
    d = ('calamares', 'veil')
    save(fit(load('veil-icon.png'), 128), *d, 'logo.png')
    save(fit(load('veil-icon.png'), 64), *d, 'icon.png')

    # The welcome image, and one image per slide of the slideshow.
    w, h = 800, 440
    welcome = wallpaper_mark(w, h, BG_2, BG, INK, 0.9)
    save(welcome.convert('RGB'), *d, 'welcome.png')

    slides = [
        ('slide-1', 'Welcome to Veil OS'),
        ('slide-2', 'Your Windows programs'),
        ('slide-3', 'Games, ready'),
        ('slide-4', 'Make it yours'),
        ('slide-5', 'Private by default'),
    ]
    for i, (name, _title) in enumerate(slides):
        img = wallpaper_mist(w, h, 100 + i, BG_2, BG,
                             [(ACCENT_DEEP, 0.35, 0.9), ((40, 70, 120), 0.3, 0.8)])
        save(img.convert('RGB'), *d, name + '.png')


# ------------------------------------------------------------------- preview

def contact_sheet():
    """Everything on one page, for looking at before a build."""
    items = []
    for root, _dirs, files in os.walk(OUT):
        for f in sorted(files):
            if f.endswith('.png') and 'thumbs' not in root and 'hicolor' not in root:
                items.append(os.path.join(root, f))

    cell = 220
    cols = 6
    rows = math.ceil(len(items) / cols)
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 24)), (40, 44, 52))
    dr = ImageDraw.Draw(sheet)
    for i, path in enumerate(items):
        im = Image.open(path).convert('RGBA')
        im.thumbnail((cell - 20, cell - 20))
        x = (i % cols) * cell
        y = (i // cols) * (cell + 24)
        # A checkerboard, so transparent images are visible.
        for cy in range(0, cell, 10):
            for cx in range(0, cell, 10):
                shade = 60 if (cx + cy) // 10 % 2 else 75
                dr.rectangle([x + cx, y + cy, x + cx + 9, y + cy + 9], fill=(shade, shade, shade))
        sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2), im)
        dr.text((x + 6, y + cell + 4), os.path.relpath(path, OUT)[-34:], fill=(220, 220, 220))
    return save(sheet, 'preview.png')


def main():
    os.makedirs(OUT, exist_ok=True)
    logos()
    app_icons()
    if '--icons' in sys.argv:
        print('wrote icons to', OUT)
        return
    plymouth()
    grub()
    names = wallpapers()
    calamares()
    print('wrote', OUT)
    print('wallpapers:', ', '.join(names))
    if '--preview' in sys.argv:
        print('preview:', contact_sheet())


if __name__ == '__main__':
    main()
