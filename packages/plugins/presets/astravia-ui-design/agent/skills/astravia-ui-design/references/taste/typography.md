# Typography

Type carries the design. With system fonts only, display and body come out as
the same face at two sizes — the single most recognisable generated-UI trait.
Install faces as packages (SKILL.md § Typefaces are packages too), declare them
as `--font-*` tokens, use `font-display` / `font-sans` / `font-mono` classes.

## Pairing

A frame is a pairing: one **display** face, one **body** face, and at most one
**outlier** (mono for code and numerals, or a wordmark face) used in no more than
two places. Three families is the ceiling. Weights of one family count as one.

A single family is allowed only when that is the idea — a terminal-style tool in
mono, a poster set entirely in one display face.

### Pairings by tone

Every face below is on fontsource. `V` means a `@fontsource-variable/` package
(family name ends in ` Variable`); `S` means static `@fontsource/` (import each
weight you use).

| Tone | Display | Body | Outlier |
| --- | --- | --- | --- |
| Editorial | Fraunces V · Newsreader V · Instrument Serif S · Young Serif S | Geist V · IBM Plex Sans V · Source Serif 4 V | JetBrains Mono V |
| Technical | Space Grotesk V · Geist V (600) · Martian Mono V | Geist V · IBM Plex Sans V · Inter Tight V | Geist Mono V · JetBrains Mono V |
| Brutalist | Bricolage Grotesque V (800) · Anton S · Big Shoulders Display V · Archivo V (800) | Geist V · Schibsted Grotesk V | Space Grotesk V · Geist Mono V |
| Soft | Bricolage Grotesque V (500) · Newsreader V · Figtree V | Geist V · Crimson Pro V · Figtree V | Geist Mono V |
| Luxury | Cormorant Garamond V · Bodoni Moda V · DM Serif Display S | EB Garamond V · Crimson Pro V · Literata V | — |
| Playful | Bricolage Grotesque V · Plus Jakarta Sans V · Unbounded V | Figtree V · Plus Jakarta Sans V | Space Grotesk V |
| Austere | Geist V (400) · Inter Tight V · Hanken Grotesk V | Geist V · Hanken Grotesk V | Geist Mono V |
| Atmospheric | Geist V (600) · Bricolage Grotesque V · Instrument Serif S | Geist V · Manrope V | Geist Mono V · JetBrains Mono V |

**Overused as display — pick only with a reason:** Inter, Roboto, Open Sans, Lato,
Poppins, Montserrat, DM Sans, Outfit, Sora, Playfair Display. They are what the
average page already uses.

### Chinese and other CJK copy

CJK packages are megabytes per weight; do not install them. Put a platform CJK
face after the Latin face in each stack, matched in style:

- serif display → `"Songti SC", "SimSun", serif`
- sans body/display → `"PingFang SC", "Microsoft YaHei", sans-serif`

Latin letters and numerals in a Chinese headline then render in the display face,
the Han characters in the matched platform face. When the copy is mostly CJK, the
Latin display face carries less of the identity — lean harder on weight contrast
(a 300 body against a 700–900 headline) and on size.

## Scale

Frames are fixed-size, so sizes are fixed pixels, not viewport clamps.

| Product | Suggested steps (px) |
| --- | --- |
| App screen / dashboard | 12 · 14 · 16 · 20 · 28 (· 40 for one hero number) |
| Mobile | 13 · 15 · 17 · 22 · 34 |
| Landing (1440 wide) | 14 · 18 · 24 · 40 · 64–88 |
| Slide (1920×1080) | 28 · 40 · 64 · 120+ |
| Poster | body ≥ 28; headline 3–6× body |

Pick at most four of those steps for any one frame (a single hero number may
add a fifth). When you want more hierarchy, use weight and color, not another
size.

- **Weight contrast:** heading and body differ by at least 300 (400 body → 700
  heading, or a 200–300 light display). 500 next to 600 reads as undecided.
- **Tracking:** tighten large display (`tracking-tight` / `-0.02em` to `-0.04em`);
  loosen small uppercase labels (`tracking-wider`). Never loosen body text.
- **Line height:** display 1.0–1.15 (1.0 minimum for all-caps), body 1.5–1.65.
- **Measure:** running text 45–75 characters wide (`max-w-prose` ≈ 65ch).
- **Numbers:** `tabular-nums` on every column of figures, price list, table and
  stat that updates.

## Headlines

- Aim for ≤ 7 words / ≤ 50 characters when you write the headline yourself. A
  long headline at display size is a strong generated tell; shorten it before
  shrinking it.
- Headings are upright. No italic headline and no single italicised emphasis
  word inside an upright one (`Built to <em>think</em>`) — carry emphasis with
  weight, the accent color or an underline. Italic is for emphasis inside body
  paragraphs only.
- No gradient text. No all-caps paragraphs. Nothing under 12 px, body never under
  14 px (13 px on dense desktop tables at most).

## Punctuation

Curly quotes, `—` for breaks, `–` for ranges, `…` not `...`. In Chinese copy use
full-width punctuation (，。：“”), and be consistent about spacing between Han
characters and Latin/numerals throughout a design.
