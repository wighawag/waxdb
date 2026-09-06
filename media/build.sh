#!/usr/bin/env bash
# Regenerate the raster assets from the committed SVGs.
#
# The mark's geometry is duplicated across logo.svg, icon.svg and preview.svg
# because each needs a different framing, so this script refuses to render if
# those three copies have drifted apart. Nothing here needs a font installed:
# preview.svg carries the type as outlines (preview.src.svg keeps it editable).
set -euo pipefail
cd "$(dirname "$0")"

command -v inkscape >/dev/null || { echo "error: inkscape is required" >&2; exit 1; }
MAGICK=$(command -v magick || command -v convert) || { echo "error: ImageMagick is required" >&2; exit 1; }
echo "rasteriser: $(command -v inkscape), compositor: $MAGICK"

# --- drift check --------------------------------------------------------------
# Inkscape's plain-SVG export puts every attribute on its own line and reorders
# them, so key off the element's id rather than on attributes being adjacent.
mark() { tr '\n' ' ' < "$1" | sed 's/</\n</g' | grep 'id="mark"' | grep -o 'd="[^"]*"'; }
ref=$(mark logo.svg)
[ -n "$ref" ] || { echo "error: no mark path found in logo.svg" >&2; exit 1; }
for f in icon.svg preview.svg preview.src.svg; do
	if [ "$(mark "$f")" != "$ref" ]; then
		echo "error: the mark in $f has drifted from logo.svg" >&2
		echo "       re-derive with media/concepts/final/derive.py, then card.py" >&2
		exit 1
	fi
done
echo "drift check: mark geometry identical in logo.svg, icon.svg, preview.svg, preview.src.svg"

# --- render -------------------------------------------------------------------
# 2x then downsample: hard-edged geometry stairsteps if rasterised straight to size.
inkscape preview.svg -o /tmp/waxdb-preview@2x.png -w 2560 >/dev/null 2>&1
"$MAGICK" /tmp/waxdb-preview@2x.png -resize 1280x640 -strip preview.png

inkscape icon.svg -o /tmp/waxdb-icon@2x.png -w 1024 >/dev/null 2>&1
"$MAGICK" /tmp/waxdb-icon@2x.png -resize 512x512 -strip icon.png

echo "wrote preview.png (1280x640), icon.png (512x512)"
