# Doodle Pop — Vetta Edition

## Atmosphere
A sticker sheet come to life. Vivid lime stage, cream screens, cards outlined
in thick black ink, hard paper-cut shadows, polka-dot textures and pastel
pops. Playful game-shop energy — drops, collectibles, dashboards that grin.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` is the loud lime stage — own it, don't hide it. Screen interiors
  (phone/panel content areas) sit on `cream`.
- `surface-raised` (white) for cards; `ink` (#111) for text, borders, shadows
  and the occasional BLACK hero card (white text + one lime element on it).
- `primary` (bright lime) fills CTAs — always with black text.
- `accent` (coral) is the second loud voice: hero banners, filter buttons,
  toggles, one coral moment per screen.
- `lavender` and `sky` are quieter pastels for icon tiles, illustration
  fills and rotating card art; `danger` (bubblegum red) for hearts/urgency.
- Icon tiles rotate through lime / coral / lavender / sky — never two
  neighbors in the same color.

## Signature texture: polka dots
The anti-monotony ingredient — use it, but as seasoning:
- Dot pattern via CSS, inline-style the two background props:
  `backgroundImage: radial-gradient(<dot> 1.5px, transparent 1.5px)`,
  `backgroundSize: 10px 10px` (dot = `ink` at 25–40% via color-mix, or lime
  on dark).
- Where: a dotted circle peeking from a hero card's corner (clipped by
  `overflow-hidden`), a dotted wash filling a colored banner, one big dotted
  pastel circle bleeding off the screen edge on sparse layouts.
- One or two dotted areas per screen — texture, not wallpaper.

## Typography
System font stack only. Comic confidence:
- Headings `font-extrabold` 22–36px, often ending with a coral period
  ("Images**.**"); tiny eyebrow labels 11px `font-bold uppercase
  tracking-[0.2em] text-muted`.
- Body 14–15px `font-medium`; labels 12px `font-bold`.
- Numbers (prices, counters, stats) `font-extrabold tabular-nums`; `font-mono`
  for tags/versions (`:latest`, subnets).

## Shape & depth
- THE signature: every card/button/chip gets `border-2 border-border`
  (thick black) + a HARD offset shadow (`shadow-sm`/`shadow-md`, zero blur).
- Generous radii (`rounded-xl`/`rounded-2xl`); icon tiles `rounded-xl`,
  stickers and dotted circles `rounded-full`.
- Press interaction: on hover/active, translate 1–2px toward the shadow and
  shrink the shadow one step — the paper-cut "press".

## Components
- Buttons: h-11 `rounded-xl border-2` black-outlined + `shadow-sm`; primary
  lime fill/black bold label; secondary white; coral variant for filters.
- Cards: white, `border-2`, `shadow-md`, 12–16px padding; list cards carry a
  colored icon tile (black-outlined) + name + `font-mono` meta + hairline-free
  black divider rows.
- Hero/stat banners: black or coral `rounded-2xl` cards with white/black bold
  numbers and a dotted circle detail.
- Toggles: black-outlined pills, ON = lime fill with black knob.
- Price/timer tags: black-bordered lime or white pills, `font-extrabold`.
- Sprinkle tiny ink doodles (stars ✦, hearts, squiggles) on the lime stage —
  never inside cards.

## Layout
Card-stack playfulness: slight rotations (`rotate-1`/`-rotate-2`) on stacked
promo cards, straight alignment for content grids and lists. Spacing
12/16/24; let lime or cream breathe between cards. Mobile-first compositions
welcome.

## Don'ts
- No thin/gray borders and no soft blurred shadows — ink lines and hard
  offsets only.
- Never put lime text on lime; long copy lives on white/cream, never on the
  raw lime stage.
- Dots are decoration: never behind body text, never more than two dotted
  areas per screen.
- No corporate minimalism: a screen with no dots, no doodle and no highlight
  anywhere is off-brand.
