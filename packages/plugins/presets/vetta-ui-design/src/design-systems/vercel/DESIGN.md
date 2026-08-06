# Vercel — Vetta Edition

## Atmosphere
Stark, editorial, monochrome. Black text on white space with engineering
confidence; color is an event, not a decoration. Feels like a spec sheet that
became beautiful.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- The world is `surface` (white), `surface-foreground` (black), `muted` (gray).
- `primary` is BLACK: primary buttons are solid black with white text.
- `accent` (blue) only for links, focus, and live/deploy states.
- `surface-raised` for subtle card fills; `border` hairlines do the structure.

## Typography
System font stack only. Swiss precision:
- Headings: `font-bold tracking-tight`, strong size jumps (32/24/16).
- Body 14px; captions 12–13px `text-muted`.
- `font-mono` is a first-class citizen: URLs, CLI commands, env vars, badges.

## Shape & depth
- Small radii (`rounded-md` ≈ 6px); pills only for status badges.
- Mostly flat: 1px `border` everywhere, `shadow-md` only on menus/modals.
- Empty space is the main decoration — let it breathe.

## Components
- Buttons: h-9, solid black primary, bordered white secondary; on hover they
  invert (black↔white) — the signature interaction.
- Inputs: white with 1px border, black focus border, no glow.
- Cards: bordered white rectangles with a mono label + big metric.
- Tables: generous row height, gray-500 headers in 12px uppercase.

## Layout
Grid-strict, centered content column (max ~1024px), sweeping whitespace between
sections. Spacing 8/16/24/48. One idea per section.

## Don'ts
- Never more than one hue on screen (blue) — no greens/purples/gradients.
- No gray text on gray fills; contrast is the brand.
- No heavy shadows or big radii; nothing "bubbly".
