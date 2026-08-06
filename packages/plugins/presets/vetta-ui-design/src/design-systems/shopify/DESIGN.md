# Shopify — Vetta Edition

## Atmosphere
A merchant's clean back office. Cool light gray floor, white work cards, calm
commerce green. Everything optimized for getting orders out the door.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` (#f6f6f7) app background; `surface-raised` (white) for every card.
- `primary` green for primary actions and success/paid states.
- `accent` (indigo) for informational highlights and links.
- `danger` for destructive/overdue; ink `surface-foreground`; labels `muted`;
  cards close with hairline `border` + `shadow-sm`.

## Typography
System font stack only. Ops clarity:
- Page titles `font-semibold` 20–24px; card headings 16px `font-semibold`.
- Body/controls 14px; table text 13–14px; captions 12px `muted`.
- Amounts `tabular-nums font-medium`; statuses 12px `font-medium`.

## Shape & depth
- Uniform `rounded-lg` (8px) cards and controls; badges are pills.
- Shallow, consistent depth: every card `shadow-sm` + border; `shadow-md`
  for popovers only.

## Components
- Buttons: h-9 `rounded-lg`; primary filled green; secondary white bordered;
  plain-text tertiary.
- Status badges: soft-filled pills (`primary/15`, `accent/15`, `danger/15`,
  gray) with matching dark text and a leading dot.
- Index tables: white card, 44px rows, checkbox column, hover `surface` wash,
  sortable `muted` headers.
- Banner alerts: tinted card-width strips with icon + title + action link.

## Layout
Top bar + 240px nav; content max ~998px centered. Cards stack vertically
with 16px gaps; two-column split (main + 320px aside) for detail pages.
Spacing 4/8/12/16/20.

## Don'ts
- Green is action/success only — never decorative fills or headings.
- No borderless shadow-only cards; the border+shadow pair is the signature.
- No dense excel-like grids without card wrappers; no dark theme.
