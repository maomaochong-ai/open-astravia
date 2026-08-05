# Headspace — Vetta Edition

## Atmosphere
A warm exhale. Sunrise cream, one glowing orange, deep-ink navy text, and
shapes so round they feel inflatable. Calm but never clinical — a friendly
hand on the shoulder.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` warm cream; `surface-raised` (white) for cards.
- `primary` (sunrise orange) for CTAs, progress, and the daily hero moment.
- `accent` (periwinkle blue) for secondary sessions/sleep content.
- Ink is warm navy `surface-foreground`; supporting text `muted` (soft
  violet-gray); borders are cream-toned hairlines.
- Big soft blob shapes in `primary/15` and `accent/15` may decorate cards.

## Typography
System font stack only. Rounded warmth:
- Headings `font-bold` 22–34px with normal tracking (never tight/condensed).
- Body 15–16px `leading-relaxed`; card titles 16–18px `font-semibold`.
- Durations/labels 12–13px `font-medium text-muted`.

## Shape & depth
- Maximum roundness: cards `rounded-2xl`–`rounded-[32px]`, buttons
  `rounded-full`, images in circles or squircles.
- Depth is soft and diffuse: `shadow-sm` resting cards, `shadow-md` hover —
  never hard edges.

## Components
- Buttons: pill h-12; primary filled orange with white bold label; secondary
  white pill with navy text and hairline border.
- Session cards: white `rounded-2xl` with a colored blob illustration area,
  title, duration chip (`surface` pill), and a small play circle.
- Progress rings: thick rounded strokes in orange on cream track.
- Greeting header: big friendly "Good morning" with sun icon and streak chip.

## Layout
Mobile-first café pacing: single column, cards stacked with 16–20px gaps,
32–40px section spacing, generous page padding (20–24px). Never dense.

## Don'ts
- No sharp corners anywhere — if it has a corner radius under 10px, round it
  more.
- No cold grays or pure white page backgrounds; warmth is the point.
- Orange never used for errors (that's `danger`); no alarming reds at all
  unless destructive.
