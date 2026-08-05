# OpenAI — Vetta Edition

## Atmosphere
A restrained research lab. Off-white calm, near-mono palette, one teal
signal. Interfaces read like well-set documents: quiet, precise, spacious.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` white; `surface-raised` (#f7f7f8) for wells, sidebars, code.
- `primary` teal used surgically: primary button, active state, links.
- `accent` purple extremely rare — a badge or a data series, never layout.
- Ink `surface-foreground` (soft near-black); most supporting text `muted`.

## Typography
System font stack only. Editorial-technical:
- Headings `font-semibold tracking-tight` 20–36px with generous top margin.
- Body 15–16px `leading-relaxed`; UI labels 13–14px.
- `font-mono` for code/model names in `surface-raised` chips with border.

## Shape & depth
- Medium-soft radii: controls `rounded-lg` (12px), cards `rounded-xl`.
- Nearly flat: hairline borders + `surface-raised` fills; `shadow-md` only on
  menus/dialogs. Whitespace is the depth.

## Components
- Buttons: h-10 `rounded-lg`; primary filled teal; secondary bordered white;
  ghost for toolbars.
- Chat blocks: alternating plain `surface` and `surface-raised` full-width
  bands with a centered ~768px text column.
- Inputs: the composer is the hero — `rounded-xl` bordered field with
  `shadow-sm` and an icon send button.
- Cards: bordered, minimal — small `muted` label, 15px title, no imagery.

## Layout
One centered reading column (~768px) for content; optional 260px sidebar on
`surface-raised`. Section spacing 48–64px; in-card spacing 16/24.

## Don'ts
- Never more than teal + one neutral on screen; no gradients, no glow.
- No dense dashboards or heavy tables; break data into quiet cards.
- No pure black text or borders — everything is softened one step.
