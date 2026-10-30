# قص قص — brand mark

## Idea: the keyframe qaf
The mark is the letter **ق** (the first letter of قص) set in Cairo Black. Its two dots are drawn as
**keyframe diamonds** (the in/out markers you see on any NLE timeline). The pair stands for the two cuts in
"cut cut". On the large icon (64 px and up) the tail of the letter is **razor-cut**: a thin slit, with the
trimmed piece dropped a few pixels, like a clip split with the blade tool.
The design is one letter and one accent colour on a dark tile. It fits the same family as pro editing tools
without copying any of them.

## Colours
| Role | Hex | Use |
|---|---|---|
| Ink | `#111418` | Tile and dark surfaces |
| Ember | `#FF5A1F` | Keyframe diamonds. Use it only for accents. |
| Bone | `#F4EFE6` | Letterform and wordmark on dark backgrounds |

Rim `#2A3038` is a 1% hairline on the large tile. It separates the tile from dark taskbars.

## Files
- `icon.png`: 1024 px app icon. `../../build/icon.png` is 512 px. `../../build/icon.ico` holds 16/24/32/48/64/128/256.
  The 16 and 24 px frames are hand-hinted pixel art with crisp diamonds. The 32 and 48 px frames use the
  small-size master: a bigger letter, no slit and no rim.
- `logo-mark.svg`: the small-size master, pure paths with no font needed. Use it at 22–28 px in the header
  and up to about 64 px.
- `logo-full.png`: mark plus the wordmark "قص قص" at 2x on a transparent background. Use it on dark
  backgrounds only, because the letters are bone-coloured.
- `logo-wordmark.png`: the wordmark only, all white, at 2x on a transparent background. The qaf dots are
  diamonds here too.

## Rules
- Don't use gradients, gloss or drop shadows on the tile. The diamonds stay ember on dark and white on
  single-colour versions.
- Wordmark typeface: Cairo 900, with the qaf dots replaced by diamonds. UI text next to the mark: Cairo 800.
