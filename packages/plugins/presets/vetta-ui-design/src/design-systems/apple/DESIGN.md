# Apple — Vetta Edition

## Atmosphere
Premium air. Soft neutral gray, white product cards, enormous typography and
enormous silence around it. Everything feels machined: perfect curves, perfect
spacing, one blue.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` (#f5f5f7) is the stage; `surface-raised` (white) for cards/sheets.
- `surface-foreground` near-black ink; long copy in `muted`.
- `primary` (blue) only on links and the single CTA per view.
- `accent` (green) strictly for success/health; `danger` for destructive.

## Typography
System font stack only — it literally is the brand's stack:
- Display headings huge and heavy: `font-semibold tracking-tight` 32–56px.
- Section titles 21–28px; body 17px with `leading-relaxed`; captions 12px.
- Size contrast does the hierarchy — weights stay between 400 and 600.

## Shape & depth
- Generous radii: cards `rounded-xl`/`rounded-2xl` (18–32px); controls curve
  fully (pill buttons).
- Depth is diffuse and quiet: `shadow-sm` resting, `shadow-md` on hover;
  borders almost invisible (`border` only where surfaces touch).

## Components
- Buttons: pill (`rounded-full`), h-9–11; filled blue primary, and the
  signature quiet secondary — blue text link with a chevron.
- Cards: big white `rounded-2xl` blocks with 24–32px padding, image-led.
- Inputs: `rounded-lg`, hairline border, focus ring `primary/30`.
- Segmented controls over tabs; toggles over checkboxes.

## Layout
Centered, symmetric, spacious. Content max ~980px; sections separated by
64–96px; card grids 2–3 columns with 16–24px gaps. Nothing touches an edge.

## Don'ts
- No dense tables or cramped rows — this language is for showcase surfaces.
- Never more than one accent hue per view; no gradients except product art.
- No sharp corners, no heavy borders, no drop shadows with hard edges.
