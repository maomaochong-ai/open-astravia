# Airbnb — Vetta Edition

## Atmosphere
Warm hospitality. Clean white, friendly rounded cards, photography doing the
talking, and one coral heartbeat. Feels human, trustworthy, vacation-ready.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` white; `surface-raised` for chips, secondary panels, footers.
- `primary` (rausch coral) for CTAs, likes, active filters — the only loud
  color, and it must not sprawl: one coral moment per view.
- `accent` (teal) tiny: superhost/verified badges.
- Ink `surface-foreground`; supporting copy `muted`.

## Typography
System font stack only. Rounded-feeling and warm:
- Headings `font-semibold` 22–32px; card titles 15–16px `font-medium`.
- Body 14–16px; metadata 12–14px `muted`.
- Prices bold; ratings with a small star glyph, 14px.

## Shape & depth
- Soft radii: cards `rounded-xl` (12–16px), search/pills `rounded-full`.
- Photos are `rounded-xl` and edge-to-edge inside cards.
- `shadow-sm` rest, `shadow-md` hover; the floating search pill uses shadow +
  hairline border.

## Components
- Buttons: h-11 `rounded-lg`; primary coral filled; secondary black-bordered
  white; text links underlined black.
- Listing card: photo top (4:3, rounded), title/meta/price stack, heart icon
  top-right on the photo.
- Filter chips: bordered pills, selected = black fill white text.
- Search bar: white pill, `shadow-md`, segmented labels divided by hairlines.

## Layout
Card grids 2–4 columns, gaps 24px; page gutters 24–48px. Sticky white header
with hairline bottom border. Generous section spacing (48px+).

## Don'ts
- Coral never fills large areas or backgrounds — buttons and icons only.
- No dark theme, no sharp corners, no heavy black shadows.
- Don't crowd cards; photos need whitespace to breathe.
