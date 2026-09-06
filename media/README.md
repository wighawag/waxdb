# waxdb brand assets

The mark is a wax seal with a `w` struck into it. A seal is what authorises a record in waxdb, since a write is only valid if the key holder signed it, and the server can neither read a record nor re-seal one.

## Files

| file | authored or generated | produced by |
| --- | --- | --- |
| `logo.svg` | generated, committed | `concepts/final/derive.py` |
| `icon.svg` | generated, committed | `concepts/final/derive.py` |
| `preview.src.svg` | generated, committed. The card with **live text**, keep for copy edits | `concepts/final/card.py` |
| `preview.svg` | generated, committed. The card with text **outlined** | `concepts/final/card.py` |
| `preview.png` | generated | `./build.sh` |
| `icon.png` | generated | `./build.sh` |
| `build.sh` | authored | |
| `concepts/final/derive.py` | authored. Derives the mark | |
| `concepts/final/card.py` | authored. Derives the card, solving every type size | |
| `concepts/sheet.sh` | authored. Renders a contact sheet if the mark is ever reworked | |
| `concepts/sheets/` | two contact sheets kept as the record: the four original directions, and the round that chose this mark | |

`build.sh` needs only Inkscape and ImageMagick, and **no installed font**, because `preview.svg` carries the type as outlines. Re-deriving from `concepts/final/` does need Lato installed.

Do not hand-edit `logo.svg`, `icon.svg`, `preview.svg` or `preview.src.svg`. Change the numbers in `concepts/final/derive.py` (mark) or `card.py` (card), rerun both, then `./build.sh`.

## Easy to fix by mistake

Each of these looks like an improvement and is not:

- **The `w` is a knockout, not a shape.** `logo.svg` is one path with `fill-rule="evenodd"`, so the letter shows whatever is behind the mark. Filling the `w` with a colour would break it on one of the two themes. Over a photo or a mid-tone, use `icon.svg`, which supplies its own plate.
- **The mark has no `currentColor`.** There is no ink in it, only accent plus the knockout, so it is already theme-agnostic. Adding an ink colour would give it a light-mode and a dark-mode failure it does not currently have.
- **`icon.svg` is not `logo.svg` on a plate by accident.** The plate exists because a transparent mark with a dark knockout disappears on a dark browser tab or npm page. The corner radius is 46, which is 18% of 256; the mark is scaled 0.86 to leave even ~7% margins.
- **The seal has no interior detail on purpose.** Every impression tried (a rim, a struck square) fought the letter. See "dropped" below.
- **The lobes are sampled at exact peaks and valleys**, 4 samples per lobe, 7 lobes, so the Catmull-Rom curve reproduces the intended silhouette with 28 segments. Resampling at an arbitrary step makes the lobes uneven.
- **`PHASE = 2.2`** rotates the lobes so that no lobe peak sits directly above or below the `w`. Changing it will make the seal look lopsided against the letter.
- **The `w` was outlined by Inkscape, and its `moveto` was absolutised.** Inkscape emits a *relative* initial `moveto`; appended after the seal's `Z` that would place the letter relative to the seal's start point, throwing it off the mark entirely. `derive.py` converts it, and the conversion is verified by rendering the even-odd result against the original mask construction (192 differing pixels at 1024px, all antialiasing on the letter's contour).

## Type

Wordmark and tagline are **Lato**, chosen against the mark: humanist bowls and softly cut terminals sit with the blot's soft edge, and the Black cut matches the mark's density.

| element | spec | solved size | solved to |
| --- | --- | --- | --- |
| wordmark `waxdb` | `font-family:'Lato';font-weight:900` | 175.00px | 520px ink width |
| tagline | `font-family:'Lato';font-weight:400` | 28.70px | 560px ink width |
| mark on the card | n/a | scale 1.3224 | 300px ink height |

Sizes are solved to a measured **ink box**, never to a nominal point size, because nominal size is not comparable across faces. The weight was confirmed by measuring rendered ink coverage (`Lato Black` and `font-weight:900` measure identically, so both load the same file; 400/700/900 measure 0.067/0.090/0.109). Re-derive by rerunning `card.py`, which re-solves every number.

The lockup is centred as a group, so a longer tagline re-centres the composition instead of pushing the text off balance.

**Licence:** Lato is OFL 1.1, which permits both outlining and redistribution. The font is not vendored here because the build does not need it.

## Directions tried and dropped

One line each, so nobody re-proposes them cold. Ten rounds of contact sheets were rendered and judged; two are kept in `concepts/sheets/` (the four opening directions, and the round that settled the mark), and the rest were deleted rather than carried in history forever. `concepts/sheet.sh` regenerates one for any new variants.

- **Signet and impression** (`concepts/`, round 1): the signet read as a person avatar, the struck disc as an eject button.
- **Bitten field** (rounds 1 to 3): a slab with a piece removed. Read as a folder plus a copy icon; refined into the edge-mouth version, which read as a clamp or a battery.
- **Ratchet** (rounds 1 to 2): the monotonic counter made visible. Read as a gear, a sun, then a camera shutter.
- **Unreadable record** (rounds 1 to 2): opaque blocks in a card. Read as a hamburger menu, then as a spreadsheet.
- **Wax seal with a bite** (rounds 4 to 6): the merge of wax and the missing piece. It worked, and lost to the `w` version because the bite and a struck letter cannot coexist.
- **Sealed envelope** (round 7): precise metaphor, fatal glyph. An envelope with a red dot is an unread-email badge at 32px and below, and waxdb has no sender, recipient or delivery.
- **Impressions inside the seal** (rounds 8 to 9): a rim read as a lasso, a struck square as a socket, and the `w` beside the bite spelled **"WC"**.

## Known gaps, accepted

- **At 16px the mark is a red rosette with a hint of a letter.** The scalloped edge is what keeps it identifiable at that size; the `w` does not survive. Accepted, since 16px use is a tab or a registry avatar where the silhouette and colour do the work.
- **The mark does not depict the project's differentiator.** Earlier rounds did depict "the authority lives outside the store", and lost to this one on legibility and name fit. The tagline now carries that idea alone.
- **A scalloped disc is also the "verified badge" shape**, shared with award rosettes and guarantee stickers. The `w` and the wax colour are what keep it specific.
- **No maskable or manifest icon set**, because no web app ships in this repo. If one lands, generate the set from `icon.svg` with a tool rather than by hand, feed it a transparent-background variant to avoid a plate inside a plate, and check the maskable safe zone (the central 80% circle).
