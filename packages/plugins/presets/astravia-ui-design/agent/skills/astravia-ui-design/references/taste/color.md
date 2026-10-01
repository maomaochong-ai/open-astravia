# Color

Generated UI fails on color first: it picks indigo, pure white and slate grey,
adds a purple-to-blue gradient, and spreads the accent over a third of the
screen. Everything below goes into `theme.css` `@theme` as tokens; frames only
ever use the utility classes.

## Principles

- **OKLCH for every token.** `oklch(L% C H)` keeps lightness honest across hues,
  so a palette built by moving L alone stays coherent. Hex is fine for a brand
  color the user handed you; derive the rest around it.
- **One accent.** Two at most. Everything else is neutral. The accent covers
  about 5 % of a frame or less.
- **Tint every neutral toward the anchor hue.** Chroma 0.005–0.015 on surfaces,
  borders and muted text. A warm accent over cool grey text looks wrong without
  anyone being able to say why.
- **No pure extremes.** Not `#000`, not `#fff` as the base surface — use
  `oklch(16–22% …)` ink and `oklch(96–98% …)` paper. The modern-minimal family
  alone may use pure white and zero-chroma greys.

## Building the palette

| Layer | Light | Dark |
| --- | --- | --- |
| `surface` (paper) | L 96–98 %, C 0.005–0.015 | L 12–18 %, C 0.008–0.015 |
| `surface-raised` | 3 % darker than surface | 3–5 % lighter than surface |
| `border` | L 82–90 % | L 26–32 % |
| `muted` (secondary text) | L 40–50 % | L 66–74 % |
| `surface-foreground` (ink) | L 16–22 % | L 92–96 % |
| `accent` / `primary` | C 0.12–0.22, any L that clears contrast | C lowered 0.02–0.04, L raised 5–10 % |

Every filled color that carries text gets a `-foreground` partner token, and that
partner is what the text uses. The most common shipped defect is dark text on a
dark button because the fill changed and the text color did not.

## Dark surfaces

- Elevation is lightness: a higher surface is lighter. Drop shadows on dark read
  as a glow; do not use them.
- Keep the anchor hue between light and dark; only lightness and chroma move.
- Light text on dark looks heavier — a body weight one step lighter reads right.

## Contrast

| Content | Minimum |
| --- | --- |
| Body text (under 24 px regular / 18 px bold) | 4.5:1 |
| Large text, icons, input borders, focus rings | 3:1 |

Quick check: if the OKLCH lightness of text and background differ by less than
50 points, assume it fails and verify. Light grey on white and muted text on
`surface-raised` are the usual misses.

## Data and status colors (apps, dashboards)

- Status colors (`danger`, `success`, `warning`) are separate tokens from the
  accent. Never reuse the brand accent to mean "good".
- Chart series: start from the anchor hue and step the hue 40–60° at matched
  lightness and chroma; four series is a lot, eight is a legend nobody reads.
  Grey out everything that is not the series being discussed.
- Red vs green alone never carries meaning — add an icon, a sign or a label.

## Where the accent goes

Active navigation item · focus ring · a link's underline · the one primary
action · a small mark beside a heading · the single data point a chart is about.

Not: whole sections, large fills, every button, decorative gradients, headings.

## Bans

- Purple-to-blue, blue-to-cyan, orange-to-pink gradients — anywhere.
- Gradient-filled text (`bg-clip-text` + gradient).
- Three-stop gradients; gradients as the main surface of a frame.
- Flat zero-chroma grey outside the modern-minimal family.
- Grey text on a colored fill — use that fill's foreground token.
- Opacity as a color definition (`text-primary/60` for body copy). A named token
  is opaque; alpha is for overlays and scrims.
- The scaffold's indigo `#4f46e5` + slate + amber kept as the final palette.
