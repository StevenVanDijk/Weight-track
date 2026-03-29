#!/usr/bin/env python3
"""
Generate WeightTrack PWA icons — bathroom scale dial design.
Colors match the app's dark theme (app.scss).
"""

from PIL import Image, ImageDraw
import math
import os

# App colour palette
BG_DARK    = (15,  23,  42,  255)   # #0f172a  — darkest bg
BG_CARD    = (30,  41,  59,  255)   # #1e293b  — card bg
BORDER     = (51,  65,  85,  255)   # #334155
PRIMARY    = (79,  70,  229, 255)   # #4f46e5  — indigo
PRI_LIGHT  = (129, 140, 248, 255)   # #818cf8
SECONDARY  = (6,   182, 212, 255)   # #06b6d4  — cyan
SUCCESS    = (16,  185, 129, 255)   # #10b981  — green
TEXT       = (241, 245, 249, 255)   # #f1f5f9
TEXT_MUTED = (148, 163, 184, 255)   # #94a3b8

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]


def aa_circle(draw, cx, cy, r, fill=None, outline=None, width=1):
    """Draw a circle using ImageDraw ellipse (PIL handles AA automatically in newer versions)."""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=outline, width=width)


def draw_icon(size: int) -> Image.Image:
    s = size
    # Work at 2× for anti-aliasing, then scale down
    scale = 2
    S = s * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx = S / 2
    cy = S / 2

    # ── Background rounded square ─────────────────────────────────────────
    corner_r = int(S * 0.22)
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=corner_r, fill=BG_DARK)

    # ── Scale platform body ───────────────────────────────────────────────
    pad = S * 0.09
    body_top    = pad * 1.1
    body_bottom = S - pad * 0.7
    body_left   = pad
    body_right  = S - pad
    body_radius = int(S * 0.18)
    draw.rounded_rectangle(
        [body_left, body_top, body_right, body_bottom],
        radius=body_radius,
        fill=BG_CARD,
    )

    # ── Dial circle ───────────────────────────────────────────────────────
    dial_r    = S * 0.275
    dial_cx   = cx
    dial_cy   = cy - S * 0.04   # slightly above centre
    dial_outline_w = max(3, S // 48)

    # outer glow / shadow ring
    glow_r = dial_r + dial_outline_w * 2
    draw.ellipse(
        [dial_cx - glow_r, dial_cy - glow_r, dial_cx + glow_r, dial_cy + glow_r],
        fill=(79, 70, 229, 60),
    )

    # main dial face
    draw.ellipse(
        [dial_cx - dial_r, dial_cy - dial_r, dial_cx + dial_r, dial_cy + dial_r],
        fill=BG_DARK,
        outline=PRIMARY,
        width=dial_outline_w,
    )

    # ── Tick marks (210° → 330°, from bottom-left to bottom-right) ───────
    # Screen angles: 0° = right, increases clockwise
    # "Top" of dial = 270°, so scale arc goes 210° → 330° (bottom arc inverted to top arc)
    # We want the readable arc at the TOP of the dial: 210°→330° in math, but
    # PIL uses clockwise-from-east angles.  We want a "cap" at the top, so:
    # top of circle = 270° in screen coords.
    # Arc from 225° to 315° clockwise covers the upper 90° — a quarter arc at top.
    # For a realistic scale dial the arc spans ~240° at the top:
    TICK_START = 225   # degrees, screen (clockwise from east)
    TICK_END   = 315   # degrees, screen
    NUM_MAJOR  = 5
    NUM_TICKS  = (NUM_MAJOR - 1) * 4 + 1   # 17 ticks total

    for i in range(NUM_TICKS):
        t = i / (NUM_TICKS - 1)
        # map t over the arc: go counter-clockwise from TICK_START to TICK_END
        # actually we go from 225 → 315 by passing through 270 (top)
        # clockwise 225 → 315 passes through bottom — we want it to pass through TOP (270)
        # so use counter-clockwise: 225 → 270 → 315 going -direction
        # That means: angle = 225 - t*(225-(-45)) ... hmm
        # Easier: arc spans -135° to -45° in math convention (counter-clockwise from east)
        #   = 225° to 315° going counter-clockwise
        # In screen coords (clockwise from east) going counter-clockwise = going negative:
        # from 225 decreasing to ... no.
        # Simple: map 0..1 → 225..315 BUT going through 270 means going 225 → 270 → 315
        # which IS clockwise from 225 to 315.  270 IS between 225 and 315 clockwise. ✓
        angle_deg = TICK_START + t * (TICK_END - TICK_START)  # 225 → 315 clockwise → passes bottom
        # We want it to pass through TOP (270). Clockwise 225→315 passes through 270 ✓ (270 is between 225 and 315)
        # Wait: clockwise from east: 0, 90(down), 180(left), 270(up), 360.
        # Clockwise 225 → 270 → 315: YES that goes through the top of the circle. ✓

        angle_rad = math.radians(angle_deg)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)

        is_major = (i % 4 == 0)
        outer_r = dial_r * 0.92
        inner_r = dial_r * (0.72 if is_major else 0.80)
        color   = TEXT if is_major else TEXT_MUTED
        width   = max(3, S // 64) if is_major else max(2, S // 96)

        x1 = dial_cx + outer_r * cos_a
        y1 = dial_cy + outer_r * sin_a
        x2 = dial_cx + inner_r * cos_a
        y2 = dial_cy + inner_r * sin_a
        draw.line([(x1, y1), (x2, y2)], fill=color, width=width)

    # ── Needle ────────────────────────────────────────────────────────────
    # Point needle at ~280° (slightly right of top — a realistic weight reading)
    needle_angle_deg = 279
    needle_angle_rad = math.radians(needle_angle_deg)
    needle_len    = dial_r * 0.62
    needle_width  = max(3, S // 72)

    # needle tip
    tip_x = dial_cx + needle_len * math.cos(needle_angle_rad)
    tip_y = dial_cy + needle_len * math.sin(needle_angle_rad)

    # slight tail (opposite side)
    tail_len = dial_r * 0.12
    tail_x = dial_cx - tail_len * math.cos(needle_angle_rad)
    tail_y = dial_cy - tail_len * math.sin(needle_angle_rad)

    draw.line([(tail_x, tail_y), (tip_x, tip_y)], fill=SUCCESS, width=needle_width)

    # ── Centre pivot dot ──────────────────────────────────────────────────
    pivot_r = max(6, S // 32)
    draw.ellipse(
        [dial_cx - pivot_r, dial_cy - pivot_r, dial_cx + pivot_r, dial_cy + pivot_r],
        fill=PRI_LIGHT,
    )

    # ── Decorative non-slip dots on lower platform ─────────────────────
    dot_y  = S * 0.77
    dot_r  = max(3, S // 80)
    n_dots = 5
    for i in range(n_dots):
        dx = cx - (n_dots - 1) * S * 0.06 + i * S * 0.06 * 2
        draw.ellipse(
            [dx - dot_r, dot_y - dot_r, dx + dot_r, dot_y + dot_r],
            fill=BORDER,
        )

    # ── Downscale to target size with Lanczos AA ──────────────────────────
    img = img.resize((s, s), Image.LANCZOS)
    return img


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "public", "icons")
    os.makedirs(out_dir, exist_ok=True)

    for size in SIZES:
        icon = draw_icon(size)
        path = os.path.join(out_dir, f"icon-{size}x{size}.png")
        icon.save(path, "PNG", optimize=True)
        print(f"  ✓ {path}")

    # Also write a 180×180 apple-touch-icon
    apple = draw_icon(180)
    apple_path = os.path.join(os.path.dirname(__file__), "public", "apple-touch-icon.png")
    apple.save(apple_path, "PNG", optimize=True)
    print(f"  ✓ {apple_path}")

    # Write a 32×32 favicon.png (keep favicon.ico separate, just generate a clean PNG)
    fav = draw_icon(32)
    fav_path = os.path.join(os.path.dirname(__file__), "public", "favicon-32.png")
    fav.save(fav_path, "PNG", optimize=True)
    print(f"  ✓ {fav_path}  (reference favicon)")

    print("\nDone — all icons generated.")


if __name__ == "__main__":
    main()
