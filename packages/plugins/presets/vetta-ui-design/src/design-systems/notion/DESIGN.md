# Notion — Vetta Edition

## Atmosphere
A quiet page that gets out of the way. Warm gray ink on white, tiny radii,
almost no chrome — the document IS the interface. Calm, bookish, utilitarian.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` (white) is the page; `surface-raised` (warm #f7f6f3) for sidebar,
  hover states, and code/callout blocks.
- `surface-foreground` is warm ink (#37352f) — never pure black.
- `primary` (blue) only on links and the rare primary button.
- `accent` (orange) for highlights/callouts, used like a highlighter pen.

## Typography
System font stack only. Editorial hierarchy:
- Page titles `font-bold` 28–32px; section headings 18–20px `font-semibold`.
- Body 14–16px with relaxed leading (`leading-relaxed`).
- Metadata/captions 12px `text-muted`; `font-mono` for inline code.

## Shape & depth
- Tiny radii (`rounded-md` ≈ 4–6px). Nothing bubbly.
- Practically flat: hover fills instead of shadows; `shadow-md` only for
  menus/popovers with their hairline ring.

## Components
- Buttons look like text until hover (ghost, `hover:bg-surface-raised`);
  filled blue is rare and small (h-8).
- Sidebar: 12–13px items, 24px row height, chevrons and tiny emoji-size icons.
- Blocks: checkbox lists, toggles, quote bars (2px left border), callouts on
  `surface-raised` with an icon.
- Tables: hairline grid, 32px rows, gray header text.

## Layout
Single reading column (~700px) with wide margins; sidebar 240px. Vertical
rhythm from text spacing (8/12/24), not boxes. Density comes from typography.

## Don'ts
- No saturated fills or colorful cards; color only via text/highlight accents.
- No big shadows, no rounded-2xl, no glassmorphism.
- Never pure black (#000) text — always the warm ink.
