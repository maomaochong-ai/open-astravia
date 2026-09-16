# Anti-patterns — the generated-UI tells

Each of these is a default the model was trained into. One in a frame is a
problem; two together and the design reads as generated at a glance. Every entry
is visible in a `vetd_screenshot`, which is where to look for them.

Format: the tell → the fix.

## Everywhere

**Purple/blue gradient surfaces.** Hero or card backgrounds fading purple→blue,
blue→cyan, orange→pink. → One anchor hue on a solid tinted surface. If it needs
warmth, tint the neutrals.

**Gradient text.** `bg-clip-text` with a gradient on a heading. → Solid ink;
emphasis from weight, size or the accent on one word.

**Aurora blobs and floating orbs.** Blurred color blobs or 3D spheres behind
content "for depth". → Cut them. The atmospheric family's one or two soft
radial glows are the only exception, background only.

**Glass as decoration.** Frosted `backdrop-blur` panels over a gradient. → Solid
surfaces. Blur only for an overlay that actually sits over content.

**Pure black / pure white, flat grey.** `bg-black`, `bg-white` base,
zero-chroma slate. → Tinted ink and paper tokens (`color.md`).

**The scaffold palette.** Indigo primary, slate surfaces and text, amber accent —
Tailwind's defaults. → Replace every value in `theme.css` with the direction's palette.

**One font at two sizes.** Display and body in the same system sans. → A real
pairing (`typography.md`).

**Italic headings.** An italic headline, or one italicised word inside an
upright one. → Upright headings; weight or accent for emphasis.

**Card-in-card.** A bordered panel holding bordered cards holding bordered chips.
→ One containment layer. Usually remove the outer one.

**Side-stripe card.** A 3–6 px colored bar on one edge of a card or alert. →
Hairline all round, a tinted surface, or a small accent mark beside the title.

**Colored glow shadows.** `shadow-lg shadow-primary/50`; any shadow on a dark
surface. → Elevation by lightness on dark; one quiet shadow level on light.

**Emoji as icons.** ✨ 🚀 ⚡ 🎯 as feature, step or tier icons. → An Iconify glyph
from one set used across the whole design, or no icon.

**Mixed icon voices.** `lucide` in the nav, `mdi` in cards, `tabler` in the footer.
→ One set per design; a second only for brand logos (`simple-icons`).

**Eyebrow on every section.** `01 / FEATURES` or an uppercase kicker over every
heading, especially a label column beside the heading. → No eyebrows unless the
content is genuinely ordinal; when used, stacked directly above its heading.

**Centred everything.** Every heading, paragraph and button on one centre axis.
→ Bias the layout; at most two centred elements per block.

**Uniform rhythm.** Every section, card and gap the same padding. → Vary it:
tight groups, generous separations.

**Invented proof.** "10× faster", "trusted by 50,000+ teams", "99.9 % uptime",
+47 % in a stat tile — numbers the user never gave. → Use the real number, a `—`
with a "metric to confirm" label, or a layout without a proof slot. Sample data
inside an app screen (orders, balances) is fine; claims about the product are
not.

**Placeholder people and products.** Jane Doe, John Smith, 张三/李四, Acme,
Nexus, "Company Name", Lorem ipsum. → Plausible, audience-specific names and
content in the user's language.

**Decoration without meaning.** A "42" in a corner, a random badge, a sticker, a
cursor glyph beside a headline. → Every ornament names something (an issue, a
year, a version, a status) or goes.

## Landing pages

**The three-column icon-tile feature grid.** Three equal cards, icon above title
above two lines. → Vary spans (2:1, a 2×2 lead tile), pull icons inline, drop the
cards for typographic rows, or use fewer items.

**Full-height centred hero.** One short sentence centred in a viewport-tall
block with one big button. → Hero as tall as its content, biased left or right,
headline + a real lede + the action visible in the first 800 px.

**The default nav.** Wordmark left, 4–5 links, button right, full width, hairline
below — on every kind of site. → A nav that fits the genre: a masthead for
editorial, a detached floating pill for product sites, two links when there are
two destinations, a side rail for long documents.

**The default footer.** Four link columns (Product / Company / Resources / Legal),
social icon row, tiny copyright. → Close the page instead: a closing statement,
one inline line, a colophon. Link columns only for a real hub with a real sitemap.

**Re-drawn chrome.** Fake browser bars with traffic-light dots around a screenshot,
CSS phone bezels with a notch, fake window chrome around a code block. → Show the
content itself with at most a hairline frame. Device mockups come from the
canvas's mockup export, never from markup inside a frame.

**The template sequence.** Hero → logo strip → three features → testimonials →
pricing → CTA → footer, identically every time. → Pick a structure from
`landing-structures.md`; include only the sections the brief needs.

## App screens and dashboards

**The generated dashboard row.** Four identical KPI cards, each with an icon
chip, a big number, a green "+12.5 %" and a sparkline. → Only real, decision-
relevant metrics; vary emphasis (one lead figure, the rest quieter inline);
drop the icon chips.

**Everything is boxed.** Every panel carrying the same border, radius and shadow
on a grey page; a divider under every heading; a border on the nav and the
sidebar. → Space, the shared gutter and surface tone carry the structure; cards
for things that are objects (a project, an order), and lines where they answer
`whitespace.md`'s question.

**Lists as card grids.** Twelve records rendered as twelve cards. → A table or a
dense list with aligned columns when people compare or scan records.

**Rainbow charts.** Every series a different saturated color, gradient area fills,
3D or glossy bars. → Anchor-derived series, one highlighted, the rest muted;
flat fills.

**Icon-for-every-nav-item sidebar sprawl.** Fifteen top-level items with random
glyphs. → Group, collapse, and keep glyphs that genuinely help recognition.

**Gradient avatar circles and initials everywhere.** → Neutral tinted avatars;
color only when it encodes something (a user's assigned color, a status).

**Status by color alone.** Green/red dots with no label. → Dot plus text, or a
labelled badge.

## Mobile screens

**Drawn device.** Notch, bezel, fake status bar with a hand-built battery. → The
frame is the screen. A plain status bar row is acceptable when the screen needs
one; the device is added by mockup export.

**Floating centred card on a gradient.** A login or onboarding form as a card
floating mid-screen. → Full-bleed screen layout, content anchored to the top,
primary action within thumb reach at the bottom.

**Five equal bottom actions plus a FAB.** → One primary action per screen; the
tab bar holds navigation, not actions.

## Slides and posters

**Centred title + subtitle on a gradient.** The default title slide. → A
composition: off-centre type at an extreme size, one focal element, solid or
photographic ground.

**Bullet walls.** Six bullets at 28 px. → One idea per slide; the claim as the
headline, evidence as one chart, number or image.
