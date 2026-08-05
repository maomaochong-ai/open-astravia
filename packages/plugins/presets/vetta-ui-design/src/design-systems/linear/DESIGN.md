# Linear — Vetta Edition

## Atmosphere
Engineered calm. A near-black workspace where information is dense but never
noisy; everything feels fast, precise, and slightly luminous. The UI recedes,
the work glows.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` is the page; `surface-raised` for cards, popovers, sidebars.
- `primary` (soft indigo) only on the main action and active states.
- `accent` (cyan) is rare: live indicators, links, one highlight per screen.
- Text is `surface-foreground`; secondary text and icons are `muted`.
- Hairline `border` separates zones; prefer borders over shadows for structure.

## Typography
System font stack only. Tight and technical:
- Headings: `font-semibold tracking-tight`, sizes 15–24px. Never oversized.
- Body 13–14px, `text-muted` for metadata at 12px.
- Monospace (`font-mono`) for ids, shortcuts, counts.

## Shape & depth
- Radius scale is small (`rounded-md`/`rounded-lg` ≈ 6–8px). No pills except tags.
- Depth comes from `surface-raised` + 1px `border`, not big shadows.
- `shadow-lg` reserved for popovers/dialogs floating above the canvas.

## Components
- Buttons: compact (h-8), `rounded-md`, subtle; primary is filled indigo, the
  rest are ghost with hover `bg-surface-raised`.
- Inputs: dark field with 1px border, focus ring in `primary/40`.
- Lists/tables are the heart: 36–40px rows, hairline dividers, right-aligned
  meta, tiny status dots in `accent`/`danger`.
- Keyboard hints everywhere: bordered `font-mono` keycaps.

## Layout
High density, strict alignment. Sidebar 220–240px, content in a single wide
column. Spacing rhythm 4/8/12/16; section gaps 24px max. No hero whitespace.

## Don'ts
- No pure white anywhere; the brightest text is `#f7f8f8`.
- No colorful gradients, no more than one accent per view.
- No large rounded cards or soft floating shadows — this is not a marketing page.
