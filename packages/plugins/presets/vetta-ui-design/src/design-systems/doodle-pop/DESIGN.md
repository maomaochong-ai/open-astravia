# Doodle Pop — Vetta Edition

## Atmosphere
A sticker sheet come to life. Vivid lime stage, white cards outlined in thick
black ink, hard paper-cut shadows, pastel doodle art everywhere. Playful
game-shop energy — NFT drops, collectibles, kids-of-all-ages products.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` is the loud lime page itself — own it, don't hide it.
- `surface-raised` (white) for every card, phone-screen panel, and sheet.
- `primary` (lime, one step brighter) fills CTAs — always with BLACK text.
- Ink is `surface-foreground` (#111): text, borders, shadows, doodles.
- `accent` (pastel lavender) for illustration fills and secondary chips;
  sibling pastels are welcome as `accent/40`-style washes inside artwork.
- `danger` (bubblegum red) for hearts/likes/urgent timers.

## Typography
System font stack only. Comic confidence:
- Headings `font-extrabold` 22–36px; punch single words with an `accent` or
  `primary` highlighter wash behind them (rounded `px-1` marks).
- Body 14–15px `font-medium`; labels 12px `font-bold`.
- Numbers (prices, counters, countdowns) `font-extrabold tabular-nums` in
  small bordered chips.

## Shape & depth
- THE signature: every card/button/chip gets `border-2 border-border`
  (thick black) + a HARD offset shadow (`shadow-sm`/`shadow-md`, zero blur).
- Generous radii (`rounded-xl`/`rounded-2xl`); stickers and avatars can be
  `rounded-full`.
- Press interaction: on hover/active, translate 1–2px toward the shadow and
  shrink the shadow one step — the paper-cut "press".

## Components
- Buttons: h-11 `rounded-xl border-2` black-outlined; primary is lime fill +
  black bold label; secondary is white fill. Both carry `shadow-sm`.
- Cards: white, `border-2`, `shadow-md`, 12–16px padding; artwork area is a
  pastel block (`accent` washes) with doodle content, itself black-outlined.
- Stat chips: small white bordered boxes in rows (value bold, label 11px
  `muted`).
- Price/timer tags: black-bordered lime or white pills, `font-extrabold`.
- Sprinkle tiny ink doodles (stars ✦, hearts, squiggles) as absolutely
  positioned decorations on the lime background — never inside cards.

## Layout
Card-stack playfulness: slight rotations (`rotate-1`/`-rotate-2`) on stacked
cards, straight alignment for content grids. Spacing 12/16/24; let the lime
background show between cards. Mobile-first compositions welcome.

## Don'ts
- No thin/gray borders and no soft blurred shadows — ink lines and hard
  offsets only.
- Never put lime text on lime, or body text on the raw lime page — long copy
  lives on white cards.
- No corporate minimalism: if a screen has no doodle, no highlight mark and
  no rotation anywhere, it's off-brand.
