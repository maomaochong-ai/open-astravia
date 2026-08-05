# Spotify — Vetta Edition

## Atmosphere
A dark stage where content is the light. Near-black layers, album-art color,
one electric green that means "play". Bold type, pill buttons, zero hesitation.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` (#121212) base; `surface-raised` for cards/rows; hover lightens
  another step (use `white/10` overlays).
- `primary` green is SACRED: play/CTA only, with black text on it.
- `accent` (brighter green) for equalizer/live/active states.
- Text white; secondary `muted`; `border` rarely — layers do the separation.

## Typography
System font stack only. Loud and confident:
- Headings `font-bold` to `font-black`, tight (`tracking-tight`), 24–48px.
- Body 14px; metadata 12–13px `muted`.
- Title case never — sentence case everywhere.

## Shape & depth
- Cards `rounded-lg` (8px); buttons are full pills (`rounded-full`).
- Depth by lightness steps between layers, plus `shadow-md` on hover cards;
  album art gets `shadow-lg`.

## Components
- Primary button: green pill, black bold label, h-12, scales slightly on hover.
- Cards: `surface-raised` with cover image on top, title + `muted` line under;
  a floating green play circle appears on hover.
- Rows (tracks): 56px, index/cover/title/artist/duration, hover `white/10`.
- Nav: left rail with bold 14px items; active is pure white, rest `muted`.

## Layout
Content shelves: horizontal card rows with bold shelf titles + "Show all".
Grid gaps 16–24px; page padding 24–32px. Density medium; imagery carries it.

## Don'ts
- Green is never a text color or background wash — buttons/indicators only.
- No light theme, no thin gray hairline aesthetics, no small timid headings.
- Never place black text on dark layers; contrast is white/muted only.
