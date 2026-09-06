#!/usr/bin/env python3
"""Derive the 1280x640 card: solve type sizes to measured ink boxes, lay the
lockup out, emit media/preview.src.svg (live text) and media/preview.svg (text
converted to outlines, so the build needs no font installed).

Every size here is SOLVED to a target ink width, never a nominal point size, so
changing the copy or the face re-derives cleanly: rerun this file.
"""
import pathlib
import re
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
MEDIA = HERE.parent.parent

W, H = 1280, 640
BG = "#12141a"
ACCENT = "#d8452e"
INK = "#eef1f6"
MUTED = "#8e97a8"

WORDMARK = "waxdb"
TAGLINE = "the key holder writes, the server just keeps it"
WORD_SPEC = "font-family:'Lato';font-weight:900"
TAG_SPEC = "font-family:'Lato';font-weight:400"
WORD_INK_W = 520.0      # target ink width of the wordmark
TAG_INK_W = 560.0       # target ink width of the tagline
MARK_INK_H = 300.0      # target ink height of the mark
GAP_MARK_TEXT = 74.0    # ink gap between mark and type
RULE_W, RULE_H = 120.0, 6.0
GAP_WORD_RULE = 30.0
GAP_RULE_TAG = 28.0


def f(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


def query(svg_text, want_id):
    """Return the ink box (x, y, w, h) of one element, via Inkscape."""
    with tempfile.TemporaryDirectory() as td:
        p = pathlib.Path(td) / "q.svg"
        p.write_text(svg_text)
        out = subprocess.run(["inkscape", str(p), "--query-all"],
                             capture_output=True, text=True, check=True).stdout
    for row in out.strip().split("\n"):
        parts = row.split(",")
        if parts[0] == want_id:
            return tuple(float(v) for v in parts[1:5])
    raise SystemExit(f"no ink box for {want_id}")


def solve_size(text, spec, target_w, start=120.0, rounds=3):
    size = start
    for _ in range(rounds):
        svg = (f"<svg xmlns='http://www.w3.org/2000/svg' width='2000' height='400'>"
               f"<text id='probe' x='40' y='300' style=\"{spec};font-size:{size}px\">{text}</text></svg>")
        _, _, w, _ = query(svg, "probe")
        size *= target_w / w
    svg = (f"<svg xmlns='http://www.w3.org/2000/svg' width='2000' height='400'>"
           f"<text id='probe' x='40' y='300' style=\"{spec};font-size:{size}px\">{text}</text></svg>")
    box = query(svg, "probe")
    return size, box


def main():
    mark_path = re.search(r'id="mark"[^>]*?\sd="([^"]+)"',
                          (MEDIA / "logo.svg").read_text()).group(1)

    # --- mark ink box, measured in its own 256 box -------------------------
    probe = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
             'width="256" height="256">'
             f'<path id="mark" fill="{ACCENT}" fill-rule="evenodd" d="{mark_path}"/></svg>')
    mx, my, mw, mh = query(probe, "mark")
    mark_scale = MARK_INK_H / mh
    mark_w = mw * mark_scale

    # --- type, solved to ink widths ----------------------------------------
    word_size, (wx, wy, ww, wh) = solve_size(WORDMARK, WORD_SPEC, WORD_INK_W)
    tag_size, (tx, ty, tw, th) = solve_size(TAGLINE, TAG_SPEC, TAG_INK_W, start=40.0)

    # --- lockup geometry, assembled from ink boxes -------------------------
    text_block_h = wh + GAP_WORD_RULE + RULE_H + GAP_RULE_TAG + th
    lock_w = mark_w + GAP_MARK_TEXT + max(WORD_INK_W, TAG_INK_W)
    lock_h = max(MARK_INK_H, text_block_h)
    lock_x = (W - lock_w) / 2
    lock_y = (H - lock_h) / 2

    mark_x = lock_x
    mark_y = lock_y + (lock_h - MARK_INK_H) / 2
    text_x = lock_x + mark_w + GAP_MARK_TEXT
    text_y = lock_y + (lock_h - text_block_h) / 2

    # SVG places text by BASELINE, and the probe reports its INK box, so the
    # baseline sits (probe_baseline - ink_top) below the ink top we want.
    word_baseline = text_y + (300.0 - wy)
    word_x = text_x - (wx - 40.0)
    rule_y = text_y + wh + GAP_WORD_RULE
    tag_ink_top = rule_y + RULE_H + GAP_RULE_TAG
    tag_baseline = tag_ink_top + (300.0 - ty)
    tag_x = text_x - (tx - 40.0)

    mark_tx = mark_x - mx * mark_scale
    mark_ty = mark_y - my * mark_scale

    # --- texture: the seal outline, faint, in the empty lower right --------
    seal_only = mark_path.split(" M ")[0]
    tex = "\n".join(
        f'    <path d="{seal_only}" fill="none" stroke="{ACCENT}" stroke-width="6" '
        f'transform="translate({f(px)} {f(py)}) scale({f(s)})"/>'
        for px, py, s in [(1042, 402, 0.95), (1170, 214, 0.55), (966, 92, 0.42),
                          (1146, 556, 0.34)])

    body = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <radialGradient id="glow" cx="18%" cy="82%" r="62%">
      <stop offset="0%" stop-color="{ACCENT}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="{ACCENT}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="{BG}"/>
  <rect width="{W}" height="{H}" fill="url(#glow)"/>
  <g opacity="0.05">
{tex}
  </g>
  <g transform="translate({f(mark_tx)} {f(mark_ty)}) scale({f(mark_scale)})">
    <path id="mark" fill="{ACCENT}" fill-rule="evenodd" d="{mark_path}"/>
  </g>
  <text id="wordmark" x="{f(word_x)}" y="{f(word_baseline)}" fill="{INK}"
        style="{WORD_SPEC};font-size:{f(word_size)}px">{WORDMARK}</text>
  <rect x="{f(text_x)}" y="{f(rule_y)}" width="{f(RULE_W)}" height="{f(RULE_H)}" fill="{ACCENT}"/>
  <text id="tagline" x="{f(tag_x)}" y="{f(tag_baseline)}" fill="{MUTED}"
        style="{TAG_SPEC};font-size:{f(tag_size)}px">{TAGLINE}</text>
</svg>
'''
    (MEDIA / "preview.src.svg").write_text(body)

    # outline the text so the build needs no font installed
    subprocess.run(["inkscape", str(MEDIA / "preview.src.svg"),
                    "--export-type=svg", "--export-plain-svg",
                    "--actions=select-all;object-to-path",
                    "-o", str(MEDIA / "preview.svg")],
                   check=True, capture_output=True)

    print(f"mark   ink {mw:.1f}x{mh:.1f} in its 256 box, scaled x{mark_scale:.4f}")
    print(f"word   size {word_size:.2f}px -> ink {ww:.1f}x{wh:.1f}")
    print(f"tag    size {tag_size:.2f}px -> ink {tw:.1f}x{th:.1f}")
    print(f"lockup {lock_w:.1f}x{lock_h:.1f} at ({lock_x:.1f}, {lock_y:.1f})")
    print("wrote media/preview.src.svg, media/preview.svg")


if __name__ == "__main__":
    main()
