#!/usr/bin/env python3
"""Derive the locked mark geometry once, and emit media/logo.svg + media/icon.svg.

Not part of the build: build.sh only rasterises the committed SVGs. This file is
the record of where the numbers came from, and how to re-derive them if the mark
ever changes.

The seal is a 7-lobe blot sampled at exact peaks and valleys (4 samples/lobe)
and smoothed with Catmull-Rom. The w is authored as a stroke, then converted to
an outline by Inkscape, so the shipped mark is ONE path: seal + w subpaths with
fill-rule="evenodd", which knocks the letter out of the wax.
"""
import math
import pathlib
import re
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
MEDIA = HERE.parent.parent

ACCENT = "#d8452e"
PLATE = "#12141a"

# --- locked parameters -------------------------------------------------------
CX = CY = 128.0
R0 = 110.0          # base radius of the blot
AMP = 0.060         # lobe depth, as a fraction of R0
LOBES = 7
PHASE = 2.2         # radians; rotates the lobes so no peak sits under the w
W_X0, W_X1 = 77.0, 179.0
W_TOP, W_BOT = 95.0, 164.0
W_STROKE = 26.0
W_MID_RISE = 0.42   # height of the middle vertex, as a fraction of the w's box
ICON_PLATE_R = 46.0     # 18% of 256
ICON_SCALE = 0.86       # leaves ~7% margins


def f(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


def blob_path():
    """Catmull-Rom through 4 samples per lobe, hitting every peak and valley."""
    n = LOBES * 4
    step = 360.0 / n
    first_peak = -math.degrees(PHASE) / LOBES
    pts = []
    for k in range(n):
        th = first_peak + k * step
        r = R0 * (1 + AMP * math.cos(math.radians(LOBES * th) + PHASE))
        pts.append((CX + r * math.cos(math.radians(th)), CY + r * math.sin(math.radians(th))))
    d = [f"M{f(pts[0][0])} {f(pts[0][1])}"]
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f"C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}")
    return " ".join(d) + " Z"


def w_stroke_d():
    mid = (W_X0 + W_X1) / 2
    q = (W_X1 - W_X0) / 4
    y_mid = W_TOP + (W_BOT - W_TOP) * W_MID_RISE
    return (f"M{f(W_X0)} {f(W_TOP)} L{f(W_X0 + q * 0.9)} {f(W_BOT)} "
            f"L{f(mid)} {f(y_mid)} L{f(W_X1 - q * 0.9)} {f(W_BOT)} L{f(W_X1)} {f(W_TOP)}")


def w_outline():
    """Convert the stroked w to a filled outline with Inkscape."""
    with tempfile.TemporaryDirectory() as td:
        src, dst = pathlib.Path(td) / "w.svg", pathlib.Path(td) / "w-out.svg"
        src.write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
            'width="256" height="256">'
            f'<path fill="none" stroke="#000" stroke-width="{f(W_STROKE)}" '
            f'stroke-linecap="round" stroke-linejoin="round" d="{w_stroke_d()}"/></svg>')
        subprocess.run(
            ["inkscape", str(src), "--export-type=svg", "--export-plain-svg",
             "--actions=select-all;object-stroke-to-path", "-o", str(dst)],
            check=True, capture_output=True)
        out = dst.read_text()
    m = re.search(r'\sd="([^"]+)"', out)
    if not m:
        raise SystemExit("stroke-to-path produced no path")
    if "transform" in out.split("<path")[1].split(">")[0]:
        raise SystemExit("unexpected transform on the outlined w")
    d = " ".join(m.group(1).split())
    # Inkscape emits a RELATIVE initial moveto. Appended after the seal's Z that
    # would be relative to the seal's start point, throwing the w off the mark,
    # so absolutise the first command. Everything after it stays relative to it.
    if d.startswith("m "):
        d = "M " + d[2:]
    elif d[0] == "m":
        d = "M" + d[1:]
    return d


def main():
    seal = blob_path()
    w = w_outline()
    mark = f"{seal} {w}"

    (MEDIA / "logo.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" '
        'height="256" role="img" aria-label="waxdb">\n'
        '  <title>waxdb</title>\n'
        f'  <path id="mark" fill="{ACCENT}" fill-rule="evenodd" d="{mark}"/>\n'
        '</svg>\n')

    off = 128 * (1 - ICON_SCALE)
    (MEDIA / "icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" '
        'height="256" role="img" aria-label="waxdb">\n'
        '  <title>waxdb</title>\n'
        f'  <rect width="256" height="256" rx="{f(ICON_PLATE_R)}" fill="{PLATE}"/>\n'
        f'  <g transform="translate({f(off)} {f(off)}) scale({ICON_SCALE})">\n'
        f'    <path id="mark" fill="{ACCENT}" fill-rule="evenodd" d="{mark}"/>\n'
        '  </g>\n</svg>\n')

    print(f"seal path: {len(seal)} chars, w outline: {len(w)} chars")
    print("wrote media/logo.svg, media/icon.svg")


if __name__ == "__main__":
    main()
