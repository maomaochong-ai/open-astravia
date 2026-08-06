# Coinbase — Vetta Edition

## Atmosphere
Institutional crypto. Bank-grade white and near-black ink with one decisive
blue; numbers front and center, zero visual risk. Feels regulated, liquid,
exact.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` white; `surface-raised` for wells, rows, secondary panels.
- `primary` (#0052ff) owns every action: buttons, links, active tabs, chart
  line.
- `accent` green = positive deltas only; `danger` red = negative deltas and
  destructive. Never decorative.
- Ink `surface-foreground` near-black; supporting text `muted`.

## Typography
System font stack only. Numbers are the interface:
- Balances huge: `font-semibold tracking-tight tabular-nums` 32–48px.
- Headings 18–24px `font-semibold`; body/labels 14px; captions 12–13px
  `muted`.
- Every numeric column `tabular-nums`; deltas prefixed +/− and colored.

## Shape & depth
- Controls `rounded-lg`–`rounded-xl` (12–16px); primary CTAs are full pills.
- Nearly flat: hairline `border` rows/cards; `shadow-md` only on menus and
  the trade panel.

## Components
- Buttons: h-11 pill; primary filled blue; secondary `surface-raised` fill
  with ink text (no borders on secondary).
- Asset rows: 56–64px — icon circle, name + ticker `muted`, sparkline,
  price + colored delta right-aligned, hairline dividers.
- Stat header: portfolio balance block with delta pill under it.
- Tabs: text with 2px blue underline; filter chips as bordered pills.

## Layout
Centered content ~1120px, main column + 360px trade/side panel. Row lists
dominate; spacing 8/16/24. White space communicates safety — never cram.

## Don'ts
- Blue never appears as tinted backgrounds or washes; solid or nothing.
- Green/red only for market movement and confirmations — no decoration.
- No gradients, no glass, no dark panels mixed into the light app.
