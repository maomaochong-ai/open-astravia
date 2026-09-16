# Directions

Read before the first frame of a new design that has no style pack and no
`DESIGN.md`. A direction is four decisions made on purpose, instead of the
indigo-on-slate, one-sans, centred-card defaults that every model reaches for:

1. **Tone** — one extreme, named.
2. **Anchor hue** — the single hue the whole palette leans toward.
3. **Type pairing** — a display face and a body face that visibly differ.
4. **Structure** — the page shape (landing: `landing-structures.md`; app: `app-density.md`).

State it in one line in your reply before building, so the user can redirect
cheaply:

> Direction: editorial · anchor warm oat (80°) · Fraunces + Geist · Long Document

## Tone — pick an extreme

*editorial · technical · brutalist · soft · luxury · playful · austere · atmospheric*

"Clean and modern" is not a tone; it is the absence of one, and it renders as the
average of every SaaS template. Read the tone off the product and its audience —
a bakery, a compliance tool and a kids' reading app should not come out as
colour-swaps of one another. When the user named a vibe, that is the tone.

## Four families

The tone picks the family: editorial, luxury and brutalist start from Editorial;
technical and austere from Modern-minimal; atmospheric from Atmospheric; soft and
playful from Playful. Each family scopes palette, type and shape. Start from its
`theme.css` block, then tune the hue to the product. Token names match the
scaffold, so existing frames keep resolving; add tokens, do not rename these.

### Editorial — content-led, considered, printed

Portfolios, publications, studios, food and craft brands, considered consumer
products. The default when nothing else fires.

- Type: a serif or characterful display (Fraunces, Newsreader, Instrument Serif,
  Cormorant Garamond) over a plain sans or reading serif body.
- Shape: the one family where a rule is typographic style — hairlines instead of
  card borders, never a box around a section. Square or 2–4 px corners,
  asymmetric columns, generous but uneven whitespace.
- Avoid: pill buttons with fills, glass, centred everything.

```css
@theme {
	--color-surface: oklch(96.5% 0.012 80);
	--color-surface-raised: oklch(93% 0.014 80);
	--color-surface-foreground: oklch(20% 0.012 60);
	--color-muted: oklch(46% 0.012 70);
	--color-border: oklch(84% 0.012 80);
	--color-primary: oklch(20% 0.012 60);
	--color-primary-foreground: oklch(96.5% 0.012 80);
	--color-accent: oklch(53% 0.17 40);
	--color-danger: oklch(55% 0.19 28);
	--radius-card: 2px;
}
```

### Modern-minimal — instrument-grade, precise

SaaS, developer tools, APIs, B2B, most dashboards and admin consoles.

- Type: a grotesk display (Geist, Space Grotesk, Schibsted Grotesk, Inter Tight
  at 600+) with a mono for code and numerals (Geist Mono, JetBrains Mono).
- Shape: precision comes from alignment and a strict spacing scale, not from
  drawing the grid — a 1 px `border-border` line only where `whitespace.md` says
  one is earned (table, real object, overlap, field). 6–8 px radii, almost no
  shadow. Monochrome, with the accent as a signal only (active item, focus, one
  CTA).
- Allowed here only: pure white surface and zero-chroma greys.

```css
@theme {
	--color-surface: oklch(99% 0.003 250);
	--color-surface-raised: oklch(97% 0.004 250);
	--color-surface-foreground: oklch(22% 0.015 258);
	--color-muted: oklch(50% 0.015 257);
	--color-border: oklch(90% 0.006 250);
	--color-primary: oklch(22% 0.015 258);
	--color-primary-foreground: oklch(99% 0.003 250);
	--color-accent: oklch(53% 0.19 256);
	--color-danger: oklch(56% 0.2 27);
	--radius-card: 8px;
}
```

### Atmospheric — dark canvas, one warm light

AI and generative tools, music, video, creative tools, anything "after dark".

- Type: a weighty sans display, tight tracking (Geist 600, Bricolage Grotesque),
  or one classical serif headline for a premium register (Instrument Serif).
- Shape: dark surfaces lifted by lightness, not shadow or borders — separation
  is a step in surface lightness; at most two soft radial glows in the accent hue
  behind content — background only, never on text.
- Avoid: glass, multiple accent hues, light sections sneaking into a dark page.

```css
@theme {
	--color-surface: oklch(15% 0.01 40);
	--color-surface-raised: oklch(20% 0.012 40);
	--color-surface-foreground: oklch(94% 0.006 80);
	--color-muted: oklch(70% 0.01 60);
	--color-border: oklch(30% 0.01 40);
	--color-primary: oklch(72% 0.16 55);
	--color-primary-foreground: oklch(18% 0.02 50);
	--color-accent: oklch(72% 0.16 55);
	--color-danger: oklch(66% 0.19 28);
	--radius-card: 14px;
}
```

### Playful — soft, friendly, still exact

Consumer apps, onboarding-heavy products, family, community, habit and learning
apps. Pick it only when the brief asks for friendly; most consumer briefs are
editorial.

- Type: a rounded or humanist display (Bricolage Grotesque, Plus Jakarta Sans,
  Figtree) with the same or a plain sans body.
- Shape: 12 px radius ceiling on cards, soft low-chroma tinted bands between
  sections (the band separates, so no border on it), one soft shadow level.
- Avoid: saturated app-store pink/purple, emoji as icons, anything "zany".

```css
@theme {
	--color-surface: oklch(97.5% 0.012 95);
	--color-surface-raised: oklch(94.5% 0.02 95);
	--color-surface-foreground: oklch(24% 0.02 280);
	--color-muted: oklch(50% 0.02 280);
	--color-border: oklch(88% 0.015 95);
	--color-primary: oklch(50% 0.13 282);
	--color-primary-foreground: oklch(98% 0.01 95);
	--color-accent: oklch(52% 0.15 40);
	--color-danger: oklch(56% 0.19 27);
	--radius-card: 12px;
}
```

## The scaffold theme is a placeholder

`vetd_create` writes an indigo / slate / amber `theme.css` so frames resolve on
day one. It is exactly the palette this file exists to avoid. On a new design,
replace its values with the direction's palette before the first frame — keep
the token names, change every value. Never ship the scaffold palette.

## Variety across designs

When the workspace already holds other designs (`vetd_status` lists `designs`)
and the user did not ask for them to match, read one sibling's `theme.css` and
differ on at least one of: surface lightness band (dark / mid / light), display
style (serif / grotesk / rounded / mono), accent hue family (warm / cool /
neutral). Two designs that share all three read as one template recoloured.

The shape notes in each family say what a line looks like *when the design calls
for one* (`whitespace.md`) — none of them means the family boxes its sections by
default.

## Product types

- **App screens and dashboards** take the palette and type pairing, not the page
  structure. Density and hierarchy come from `app-density.md`.
- **Landing pages** take everything, plus one structure from `landing-structures.md`.
- **Slides and posters** take the pairing at its most extreme: a display size
  several steps above body, one focal element, the accent at most once.

## Who outranks this file

The user's explicit request, then a design-resource pack in `design-resources/`,
then a `DESIGN.md` in the design. When any of those sets the style, follow it
and use this directory only for `anti-patterns.md` — it catches what no style
asks for.
