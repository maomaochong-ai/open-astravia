# Slack — Vetta Edition

## Atmosphere
A friendly workplace lobby. White and airy where you read, deep aubergine
where you navigate, with candy-colored moments that keep it human. Chatty,
approachable, but organized.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` white for content; the left nav rail is the ONE dark area — fill
  it with `primary` (aubergine) and white/70 text.
- `primary` also styles primary buttons and active states outside the rail.
- `accent` (sky blue) for links/mentions/info; `danger` (pink-red) for
  notifications and destructive actions.
- Body ink `surface-foreground`; timestamps and hints `muted`.

## Typography
System font stack only. Conversational clarity:
- Channel/heading text `font-bold` 15–18px (bold, not big).
- Messages 15px with `leading-relaxed`; sender names `font-bold`.
- Timestamps/meta 12px `muted`; buttons 13px `font-semibold`.

## Shape & depth
- Modest radii (`rounded-lg` ≈ 8px); avatars `rounded-lg` (not circles).
- Mostly flat: hairline `border` between panes; `shadow-md` for popovers,
  hover toolbars, and modals only.

## Components
- Buttons: h-9 `rounded-lg`; primary filled aubergine; secondary white with
  border; a green "Go" variant only for calls/join.
- Message row: 36px avatar, name+time header line, hover reveals an icon
  toolbar floating with `shadow-sm`.
- Sidebar items: 28px rows, white/70, active = white text on `white/15` fill.
- Emoji/reaction chips: `surface-raised` pills with count, selected gets
  `accent/15` fill + accent border.

## Layout
Classic three-pane: 260px aubergine rail, content column, optional thread
pane. Message list is the page — full-height scroll with sticky date pills.

## Don'ts
- Aubergine never appears in the content pane as fills — rail/buttons only.
- Never gray-on-gray text; hints use `muted` on white.
- No sharp corporate tables; everything reads as conversation blocks.
