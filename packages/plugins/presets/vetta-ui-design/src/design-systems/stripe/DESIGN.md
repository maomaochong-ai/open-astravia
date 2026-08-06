# Stripe — Vetta Edition

## Atmosphere
Polished fintech craft. An airy blue-gray canvas with crisp white cards, one
confident blurple, and shadows so refined they read as paper. Serious money,
delightful surface.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` is the cool blue-gray page; `surface-raised` (white) for all cards.
- `primary` (blurple #635bff) for CTAs, links, active nav, chart lines.
- `accent` (cyan) sparingly for gradients-of-two and highlights.
- Headings in `surface-foreground` (deep navy); body copy in `muted`.

## Typography
System font stack only:
- Headings `font-semibold tracking-tight`, navy, sizes 20–32px.
- Body 14–15px in `muted`; the navy/slate two-tone is the signature.
- Numbers in tables use `tabular-nums`; currency amounts get `font-medium`.

## Shape & depth
- Medium radii (`rounded-lg`/`rounded-xl` ≈ 12–16px).
- The layered shadow is the brand: cards float with `shadow-sm`→`shadow-md`
  on hover; modals use `shadow-lg`. Borders are secondary to shadows.

## Components
- Buttons: h-9 `rounded-lg`, filled blurple primary with subtle shadow;
  secondary is white with border + shadow-sm.
- Inputs: white, 1px border, focus ring `primary/30` + border primary.
- Stat cards: small `muted` label, large navy number, delta in green/`danger`.
- Tables: white card container, 48px rows, hover `bg-surface`.

## Layout
Dashboard grid on 8px rhythm; cards in 2–4 column grids with 16–24px gaps.
Left nav 240px on `surface`, content cards on white.

## Don'ts
- No dark backgrounds; no pure black text (navy is the black).
- Don't mix more than blurple + cyan; no rainbow charts.
- No flat borderless-and-shadowless cards — depth is part of the language.
