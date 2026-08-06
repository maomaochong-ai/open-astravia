# Medium — Vetta Edition

## Atmosphere
A quiet magazine. White paper, serif prose, acres of margin. The chrome
whispers so the writing can speak; one green ask and one yellow highlighter.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` white page; `surface-raised` sparingly for code and side panels.
- `primary` (green) for the few real actions: follow, subscribe, publish.
- `accent` (yellow) is the brand flourish: hero backgrounds, member badges,
  highlighted text (`accent/40` wash behind serif text).
- Ink #242424 `surface-foreground`; bylines/captions `muted`; hairline
  `border` dividers.

## Typography
The whole identity — mix the two stacks deliberately:
- Article titles and prose in `font-serif`: titles `font-bold` 32–42px,
  body 20–21px `leading-relaxed`.
- UI chrome (nav, buttons, meta) in sans 13–14px.
- Kickers/bylines 13px sans `text-muted`; pull quotes serif italic 24px with
  a 3px ink left border.

## Shape & depth
- Minimal radii: buttons are pills, images/cards `rounded-md` (4px) or square.
- Flat as paper: hairline dividers organize everything; `shadow-md` only for
  menus and the sticky toolbar.

## Components
- Buttons: slim pills h-9; primary filled green; secondary bordered ink;
  most "actions" are plain `muted` icon buttons.
- Story list item: kicker + serif `font-bold` title + 2-line `muted` sans
  excerpt + meta row (avatar 20px, name, date, read time) + small square
  thumbnail right.
- Clap/response bar: `muted` icon+count pairs separated by dots.
- Topic chips: `surface-raised` pills 13px; member star in `accent`.

## Layout
One sacred reading column: 680px centered, 48–64px vertical rhythm between
blocks. List pages: 728px main + 368px sticky aside split by a hairline.
Whitespace is the design.

## Don'ts
- Never set body prose in sans, never set UI chrome in serif.
- No cards with shadows for stories — dividers, not boxes.
- Green and yellow never co-occur in one component; no other hues at all.
