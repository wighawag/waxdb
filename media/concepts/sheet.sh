#!/usr/bin/env bash
# Contact sheet: per variant, mark on light, mark on dark, icon at 64/32/16.
set -euo pipefail
cd "$(dirname "$0")"
LIGHT='#f8fafc'; DARK='#12141a'
VARIANTS=${*:-"v-a v-b v-c v-d"}
rm -f /tmp/row-*.png
for v in $VARIANTS; do
	sed 's/color: #12141a/color: #eef1f6/' "$v.svg" > "/tmp/$v-dark.svg"
	inkscape "$v.svg"           -o "/tmp/$v-l.png" -w 1024 >/dev/null 2>&1
	inkscape "/tmp/$v-dark.svg" -o "/tmp/$v-d.png" -w 1024 >/dev/null 2>&1
	inkscape "$v-icon.svg"      -o "/tmp/$v-i.png" -w 1024 >/dev/null 2>&1
	magick "/tmp/$v-l.png" -background "$LIGHT" -flatten -resize 240x240 "/tmp/L-$v.png"
	magick "/tmp/$v-d.png" -background "$DARK"  -flatten -resize 240x240 "/tmp/D-$v.png"
	for s in 64 32 16; do
		magick "/tmp/$v-i.png" -filter Lanczos -resize ${s}x${s} \
			-background "$LIGHT" -flatten -gravity center -extent 120x240 "/tmp/S$s-$v.png"
	done
	magick "/tmp/L-$v.png" "/tmp/D-$v.png" "/tmp/S64-$v.png" "/tmp/S32-$v.png" "/tmp/S16-$v.png" \
		+append -bordercolor '#c9ced8' -border 1 "/tmp/row-$v.png"
done
magick /tmp/row-*.png -append sheet.png
echo "wrote $(pwd)/sheet.png"
