# Duolingo — Vetta Edition

## Atmosphere
A cheerful game that happens to teach. Feather-green energy, chunky rounded
shapes, buttons that physically press down. Loud, friendly, impossible to
feel intimidated by.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` white; `surface-raised` for wells and locked/disabled states.
- `primary` green is everywhere it counts: CTAs, correct answers, progress.
- `accent` (sky blue) for secondary actions and informational moments.
- `danger` (soft red) for hearts/mistakes; `muted` for locked/secondary text.
- Bonus voices via soft tints (`accent/15`, `primary/15`) on cards.

## Typography
System font stack only. Chunky and loud:
- Headings `font-extrabold` 22–32px; buttons `font-bold uppercase
  tracking-wide` 14–15px.
- Body 15–17px `font-medium`; stats/streaks `font-extrabold` with icon.
- Everything slightly bolder than feels reasonable — that's the voice.

## Shape & depth
- Big radii: cards `rounded-2xl` (16–28px), buttons `rounded-xl`.
- The 3D press: buttons and cards sit on a hard bottom edge —
  `shadow-sm`/`shadow-md` are hard-edged (0 blur) drops; active state removes
  the shadow and nudges down 2px (`translate-y-0.5`).
- Borders are thick (2px) and friendly, not hairline.

## Components
- Buttons: h-12 `rounded-xl` `font-bold uppercase`; primary green with darker
  green bottom edge; secondary white with 2px border + gray bottom edge.
- Progress bars: fat (h-4) `rounded-full` green fills on `surface-raised`.
- Lesson nodes: big circles with icon, done = green, active = pulsing ring,
  locked = `surface-raised` + `muted` icon.
- Streak/gem counters: icon + `font-extrabold` number chips.

## Layout
Single centered play column (~600px) with a stats side rail on desktop.
Spacing chunky: 16/24/32. Few elements per screen, each one big and tappable.

## Don'ts
- No hairline borders, no subtle grays-on-gray, no elegant thin type.
- Green must stay vivid — never darken it into "corporate" green.
- No dense tables or small click targets; everything is a big friendly shape.
