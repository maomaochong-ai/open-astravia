# Discord — Vetta Edition

## Atmosphere
A cozy dark clubhouse. Soft charcoal layers (never pure black), blurple
energy, rounded friendly shapes. Gaming DNA: playful, badge-covered, alive.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- Three-layer depth: darkest rail (`surface-raised` darkened — use `black/20`
  overlays), `surface-raised` sidebar, `surface` content.
- `primary` blurple for CTAs, active items, mentions, brand moments.
- `accent` green strictly for online/voice-connected states.
- `danger` for pings and destructive; text `surface-foreground`, secondary
  `muted`.

## Typography
System font stack only:
- Headings `font-bold` 16–20px; channel names 15px `font-medium`.
- Messages 15px `leading-relaxed`; usernames `font-medium` and may take
  role colors (`primary`/`accent`).
- Tiny labels 11–12px `font-semibold uppercase tracking-wide text-muted`
  (category headers).

## Shape & depth
- Everything softly rounded: `rounded-lg` (8px) panels, `rounded-full`
  avatars, pill badges.
- Layer color does the depth; `shadow-lg` only for modals/popouts.

## Components
- Buttons: h-9–11 `rounded-lg`, filled blurple primary; secondary is a
  lighter charcoal fill (no borders).
- Message rows: hover `black/10` wash, floating reaction toolbar.
- Channel list: 32px rows in `muted`, active = white text on `white/10` pill.
- Badges: tiny `rounded-full` counters in `danger` with white 11px bold text;
  status dots (accent green / muted gray) on avatar corners.

## Layout
Rail (72px, circular server icons) + sidebar (240px) + chat + members (240px).
Compact rows, 8/12/16 spacing. The chat column is the hero.

## Don'ts
- Never pure black backgrounds or 1px gray hairline aesthetics — layers, not
  borders.
- Blurple never used for body text; green never decorative.
- No sharp corners anywhere; no thin/light font weights.
