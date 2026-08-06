# Netflix — Vetta Edition

## Atmosphere
A dark cinema where the interface disappears and posters glow. Black stage,
one red signature, sharp edges, big imagery. Everything says "press play".

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` (#141414) everywhere; `surface-raised` for hover cards and rows.
- `primary` red for THE action (play/subscribe) and the logo moment — nothing
  else is red except `danger` states.
- `accent` green only for match percentages and "new" tags.
- Text white; secondary `muted`; `border` almost never — darkness separates.

## Typography
System font stack only. Cinematic scale:
- Hero titles `font-black tracking-tight` 40–64px, often on imagery.
- Shelf titles 18–20px `font-bold`; card meta 12–13px `muted`.
- Buttons 14–16px `font-semibold`.

## Shape & depth
- Sharp-ish: `rounded-md` (4px) on cards/buttons; nothing bubbly.
- Depth via image glow and `shadow-lg` on the hover-expanded card; gradients
  (black→transparent) anchor text onto artwork.

## Components
- Buttons: `rounded-md` h-10–12; primary solid red; secondary `white/20`
  translucent fill with white text (over imagery).
- Poster cards: 16:9 image, no chrome at rest; on hover scale up with
  `shadow-lg` and reveal a metadata strip on `surface-raised`.
- Hero: full-bleed artwork, left-aligned title block over a horizontal
  gradient, two buttons.
- Badges: tiny red "N", green match % `font-bold`, `muted` maturity chips
  with 1px border.

## Layout
Horizontal shelves over a full-width canvas; rows of 4–6 posters with 8–12px
gaps (tight — imagery forms a wall). Page gutters 40–56px. Vertical rhythm by
shelf (32–40px between).

## Don'ts
- No white backgrounds, no cards with visible borders, no rounded-xl.
- Red never fills panels or decorates text; it is the action color.
- Never crowd artwork with UI chrome — text sits on gradients, not boxes.
