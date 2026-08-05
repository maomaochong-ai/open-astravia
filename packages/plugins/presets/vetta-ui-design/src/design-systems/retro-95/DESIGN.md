# Retro 95 — Vetta Edition

## Atmosphere
1995 desktop nostalgia, played straight. Teal desktop, gray chrome windows,
navy title bars, beveled everything. Charmingly rigid — a museum piece that
still boots.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` is the teal desktop; every window/panel is `surface-raised`
  (silver #c3c3c3).
- `primary` (navy) fills title bars and selection highlights, with white text.
- `accent` teal for desktop/secondary chrome moments; `danger` for the
  classic error red.
- Text is pure black on silver; disabled text `muted` with the classic
  white 1px offset (simulate with `text-muted` + `drop-shadow`).

## Typography
System font stack only, played small and plain:
- Everything 11–13px, `font-normal`; window titles 12px `font-bold` white.
- No tracking tricks, no large display type — headings are just bold 13px.
- `font-mono` for terminal/notepad content areas on white.

## Shape & depth
- ZERO border radius. Every corner is square — no exceptions.
- The bevel IS the depth: raised chrome = 2px light top/left
  (`border-t-white border-l-white`) + dark bottom/right
  (`border-b-[#5a5a5a] border-r-[#5a5a5a]`); sunken wells invert it.
- Shadows are hard offsets (`shadow-md` = 2px 2px 0): windows may cast one.

## Components
- Window: silver panel, navy title bar with white bold title + □ ✕ buttons
  (16px beveled squares), inner content on white with sunken bevel.
- Buttons: h-7 silver beveled rectangles, black 12px label; pressed state
  inverts the bevel and nudges text 1px down-right.
- Inputs: white sunken fields, square, black caret; no focus rings — focus is
  a 1px dotted black outline.
- Menus/toolbars: flat silver strips with beveled separators; menu items
  highlight navy with white text.
- Status bar: bottom sunken strip with beveled section dividers.

## Layout
Windows float on the teal desktop, slightly offset like real 1995. Inside a
window: menu bar (24px), toolbar, content well, status bar (24px). Spacing is
tight and even: 4/8px. Alignment is grid-perfect — the OS would not tolerate
less.

## Don'ts
- Absolutely no rounded corners, gradients, blur, or soft shadows.
- No modern minimalism: chrome is supposed to be visible and chunky.
- Never anti-historical colors (pastels, neons) — stay in the system palette.
