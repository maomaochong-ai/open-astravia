# Lines and whitespace (去线留白)

**One question, asked of every line, divider and card wrapper before you draw
it: what does it do that space could not?**

That is the whole of this file. It is not a ban — plenty of lines answer it
instantly, and a few product types answer it for nearly all of theirs. It is
aimed at the line drawn out of reflex, which is the common case: reaching for
`border` around every group is the same habit as reaching for indigo. It makes
the hierarchy *visible* without making it *true*, and it is one of the fastest
ways for a frame to read as generated. Space usually says the same thing, and
says it quieter.

## What to reach for first

1. **Group with space.** A gap twice the size of the gaps inside the group reads
   as a separation. Nothing else is needed for it.
2. **Align instead of enclosing.** One gutter for the whole frame, everything
   on it. A shared left edge does the work a box was going to do.
3. **Separate with tone when space is not available.** `surface` against
   `surface-raised` (2–4 % lightness apart), or a tinted band — a soft edge, not
   a drawn one.
4. **Let type carry the rest.** Size, weight and muted color separate a section
   heading from its content better than a rule under it.
5. **Then the line, if it still answers the question.** Draw it as one 1 px
   `border-border` hairline — not 2 px, not colored, and not on all four sides
   of something that only needed one.

## Substitutions

When the question comes back unanswered, these are what the line becomes:

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

## Answers that hold

These are the lines that answer the question in a word — draw them without a
second thought:

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

Four answered lines in a frame is normal. Fourteen means the layout was never
given the space to do its job.

## Per product type

How the question usually comes out, product by product — these are the common
answers, not a spec:

- **Dashboards / desktop apps.** Regions separated by the gutter and by
  `surface-raised` panels for objects only; the table is where the hairlines
  live. No border on the page header, the sidebar or the KPI row.
- **Mobile.** Full-bleed sections, section headings in the scroll, no card per
  row. A tab bar is separated by tone or elevation, not a `border-t`.
- **Landing pages.** Sections separated by big uneven whitespace and the
  occasional tinted band. Feature rows are typographic, not tiled cards.
- **Slides and posters.** Essentially no lines. One rule is allowed as a
  deliberate graphic mark, at a size and position that make it read as design.

## When lines are the design

Whole categories answer the question for most of their lines, and there the
question is answered once, up front, not per line. Do not apply the rest of this
file to them:

- **Wireframes and lo-fi mockups.** The drawn box *is* the notation; greyed
  outlines are what tells the viewer this is not a finished screen.
- **Reports, invoices, receipts, statements, forms to be printed.** Ruled rows
  and boxed fields are the convention of the document, and readers use them to
  track across a wide page.
- **Terminals, code editors, IDE and diff UI.** Panes, gutters and the seams
  between them are the product; the user drags those seams.
- **Engineering and operations consoles** — monitoring walls, trading screens,
  schedules, seat maps, spreadsheets, anything on a real grid. The grid is the
  data model made visible, not decoration.
- **Diagrams, schematics, maps and their legends.** Lines carry meaning.
- **Editorial and brutalist tones** (`directions.md`), where a hairline is a
  chosen typographic rule — still a rule, not a box around everything.

## Who outranks this

The user's explicit request, a `design-resources/` pack, then the design's
`DESIGN.md` — in that order. "Add dividers", "我要网格线", a wireframe look, or a
pack whose demo is visibly bordered all settle the question for that design;
follow them and stop applying this file.

## Before you call a frame done

Look at the capture and put the question to each drawn line and box. The ones
you can answer stay. Any you cannot, delete — then check that the gaps grew to
carry the grouping instead.
