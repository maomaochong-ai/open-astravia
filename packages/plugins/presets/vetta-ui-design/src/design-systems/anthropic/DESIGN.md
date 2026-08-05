# Anthropic — Vetta Edition

## Atmosphere
A well-bound book. Warm cream paper, dark ink, one clay accent — humanist,
literary, unhurried. Technology presented with the calm of print.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` (book-cloth cream #f0eee6) is the page; `surface-raised` (white)
  for cards and figures.
- `primary` is INK (#191919): primary buttons are dark ink pills with white
  text.
- `accent` (clay #cc785c) for links, highlights, small illustrations, active
  states — the single warm voice.
- Body text ink; secondary `muted` (warm gray); `border` warm hairlines.

## Typography
System font stack; lean on the serif stack for voice:
- Display/section headings in `font-serif` `font-medium` 28–44px — the
  literary signature.
- Body 15–16px sans with `leading-relaxed`; UI labels 13–14px sans.
- Quotes/figure captions may italicize serif; `font-mono` for code on white
  cards.

## Shape & depth
- Generous soft radii: cards `rounded-xl`/`rounded-2xl` (16–28px), buttons
  `rounded-full` pills.
- Nearly flat: warm borders + white cards on cream; `shadow-md` only for
  overlays. Print doesn't cast shadows.

## Components
- Buttons: pill h-10; primary ink-filled; secondary bordered cream; links in
  clay with underline on hover.
- Cards: white `rounded-2xl` with 24–32px padding, small clay eyebrow label,
  serif title, sans body.
- Callouts: cream-on-cream with a clay left border and serif lead-in.
- Diagrams favor thin ink lines with clay highlights, hand-drawn warmth.

## Layout
Reading column ~720px centered, airy 56–80px section spacing; card grids 2–3
columns with 24px gaps. Margins are generous — the page must feel unhurried.

## Don'ts
- No cool grays or blue-tinted neutrals — every neutral is warm.
- Clay never fills buttons or large areas; it is an accent voice, not a brand
  shout.
- No dark mode, no glossy shadows, no tight dense grids.
