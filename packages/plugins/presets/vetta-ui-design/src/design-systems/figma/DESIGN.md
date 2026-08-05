# Figma — Vetta Edition

## Atmosphere
A bright tool canvas with a designer's wink. Neutral chrome that stays out of
the way, blue for the active tool, purple for the spark of fun. Crisp 1px
precision everywhere.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` white canvas; `surface-raised` for toolbars/panels/wells.
- `primary` blue = selection, active tool, primary button, focus.
- `accent` purple appears in small joyful doses: badges, plan tags, community.
- Ink `surface-foreground` (near-black); labels `muted` at 11–12px.

## Typography
System font stack only. Compact tool typography:
- Panel labels 11px `font-medium uppercase tracking-wide text-muted`.
- Controls/body 12–13px; dialog titles 15–16px `font-semibold`.
- Numbers in inputs use `font-mono` 12px (coordinates, sizes, hex).

## Shape & depth
- Small radii: controls `rounded-md` (6px), floating panels `rounded-xl` (13px).
- Panels float with `shadow-md`; inline controls are flat with hairline
  `border` between sections.

## Components
- Buttons: h-8 `rounded-md`; primary filled blue; secondary bordered; icon
  buttons 32px squares with hover `bg-surface-raised`.
- Property rows: 32px, label left in `muted`, mono value input right.
- Segmented icon groups (alignment cluster) in a bordered `surface-raised` pill.
- Tabs: text-only, active gets `font-semibold` ink + 2px blue underline.

## Layout
Three-zone tool layout: left layers panel (240px), center canvas, right
properties (240px), 40px toolbars. Spacing 4/8/12 — tight but ordered by
hairline dividers.

## Don'ts
- Purple never exceeds badge-size areas; blue owns interaction.
- No large soft shadows on inline UI; only floating panels cast.
- No oversized typography — this is instrument UI, not marketing.
