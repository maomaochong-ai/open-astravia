# Whitespace over lines — the default structure (去线留白)

**Unless the user, a design-resources pack or `DESIGN.md` asks for lines, build
structure out of space, alignment and surface tone — not out of borders,
dividers and boxes.**

This is the skill's default, not one style among several. A model reaching for
`border` around every group is the same reflex as reaching for indigo: it makes
the hierarchy *visible* without making it *true*, and it is the fastest way for a
frame to read as generated. Space says the same thing and says it quieter.

## The rule

1. **Group with space.** A gap twice the size of the gaps inside the group reads
   as a separation. Nothing else is needed for it.
2. **Align instead of enclosing.** One gutter for the whole frame, everything
   on it. A shared left edge does the work a box was going to do.
3. **Separate with tone when space is not available.** `surface` against
   `surface-raised` (2–4 % lightness apart), or a tinted band — a soft edge, not
   a drawn one.
4. **Let type carry the rest.** Size, weight and muted color separate a section
   heading from its content better than a rule under it.
5. **Then, and only then, a hairline.** If a line survives all four, draw it as
   one 1 px `border-border` line — never a 2 px one, never a colored one, and
   never on all four sides of something that only needed one.

## What this removes

| The line habit | Instead |
| --- | --- |
| Every section wrapped in a bordered card | Space between sections; no box |
| `border-b` under the nav / `border-r` on the sidebar | Let the content scroll under it, or tint the bar with `surface-raised` |
| A divider between every list row | Row padding; a hairline only when rows wrap to multiple lines |
| Full grid lines in a table | Quiet header rule at most, generous row height, alignment does the columns |
| A rule under every section heading | Space above the heading, type weight below it |
| Bordered icon chips / avatar rings / outlined badges | The glyph or initials on a tinted surface, or nothing |
| Bordered input fields everywhere in a form | Filled `surface-raised` fields, or one baseline underline for the whole form |
| Card-in-card (panel → cards → chips) | One containment layer, usually the innermost |
| `divide-y` + zebra + card border on the same list | Pick one, and prefer none |

## Where a line is still earned

A line is earned when it does something space cannot:

- **Scan-critical alignment.** Dense data tables where the eye tracks across
  many columns — a quiet header rule, and row hairlines only when rows are tall
  or multi-line.
- **A real containment edge.** Something the user acts on as an object (a
  project, an order, a document) and can be dragged, selected or reordered.
- **Overlap.** A sticky header, a popover, a drawer, a modal sitting *over*
  scrolling content — the boundary is real, so draw it (or carry it with
  elevation).
- **An affordance that must be findable.** One editable field on a screen of
  static text still needs its edge.

Four earned lines in a frame is normal. Fourteen means the layout was never
given the space to do its job.

## Per product type

- **Dashboards / desktop apps.** Regions separated by the gutter and by
  `surface-raised` panels for objects only; the table is where the hairlines
  live. No border on the page header, the sidebar or the KPI row.
- **Mobile.** Full-bleed sections, section headings in the scroll, no card per
  row. A tab bar is separated by tone or elevation, not a `border-t`.
- **Landing pages.** Sections separated by big uneven whitespace and the
  occasional tinted band. Feature rows are typographic, not tiled cards.
- **Slides and posters.** Essentially no lines. One rule is allowed as a
  deliberate graphic mark, at a size and position that make it read as design.
- **Editorial / brutalist tones** (`directions.md`) are the exception where a
  hairline *is* the style — there it is a chosen typographic rule, still never a
  box around everything.

## Who outranks this

The user's explicit request, a `design-resources/` pack, then the design's
`DESIGN.md` — in that order. "Add dividers", "我要网格线", a wireframe look, or a
pack whose demo is visibly bordered all switch it off for that design; follow
them and stop applying this file. Absent any of those, this is what to build.

## Before you call a frame done

Look at the capture and count the drawn lines and boxes. For each one, name what
it does that space could not. Any you cannot name, delete — then check the gaps
grew to carry the grouping instead.
