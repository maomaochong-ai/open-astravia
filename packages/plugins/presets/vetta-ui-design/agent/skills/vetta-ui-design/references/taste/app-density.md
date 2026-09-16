# App screens and dashboards

Read when the product type is `desktop` or `mobile`. Landing-page taste rules
about heroes and page structure do not apply here; a dashboard is a tool, and it
looks designed when its hierarchy matches the job, not when it is decorated.

## Start from the task

Before the layout, answer in one sentence: what does the person on this screen
come to do or decide? That answer gets the most prominent position and the
strongest type. Everything else is secondary and looks it — smaller, muted, or
one click away.

A screen where every panel has the same weight has no answer to that question.

## Density

- Desktop tools are dense. 14 px body, 12 px secondary, 32–40 px row heights in
  tables, 16–24 px between groups. Empty middle areas and 48 px card padding on
  a 1440 frame read as a template stretched to fit.
- Use one gutter for the whole frame and align every region to it. The gutter is
  usually what separates the regions, so a border or a card around a section is a
  third choice that needs a reason (`whitespace.md`) — the page header and the
  sidebar rarely have one; tone them with `surface-raised` instead.
- Prefer **space, alignment and tone** to boxes. A card is for an object the user
  acts on (a project, an order, a document) — not a wrapper for every section.
- Compare-and-scan data is a table, and the table is where the frame's hairlines
  are allowed: left-aligned text, right-aligned `tabular-nums` numbers, units in
  the header, a quiet header rule, generous row height, and row hairlines only
  when rows are tall or multi-line — never zebra and rules together, and never
  full grid lines.

## Metrics

- Show a metric only if the user gave it or the screen's job needs it. Four KPI
  tiles because dashboards have four KPI tiles is the generated default.
- Give one figure the lead (size, position); the rest sit inline and quieter. A
  metric row is spacing and type, not four bordered tiles.
- A delta needs its baseline ("vs last week"), and its color must follow meaning
  for that metric (costs going up is not green).

## Charts

- One chart, one message. Title the chart with the finding, not the dataset
  ("Refunds doubled after the 3 March release", not "Refunds over time").
- Series colors derive from the anchor hue; highlight the series the title talks
  about, mute the rest. Flat fills, hairline gridlines, labelled axes, direct
  labels over a legend where they fit.
- Draw simple bars, lines and donuts with divs/SVG; install a chart library only
  for real axes, scales and many series (SKILL.md § Dependencies).

## Navigation

- Sidebar: grouped, short labels, 6–9 top-level items; glyphs only where they aid
  recognition. The active item is the one accent use in the nav.
- Put page-level actions in the page header, right-aligned: one primary, the rest
  secondary or in an overflow menu.

## States

Design what the screen really goes through — a first-run empty state with one
next action, a loading skeleton that matches the layout, a no-results state for
search and filters, an error with what happened and what to do (`copy.md`).
Where a state is reachable by clicking, make it real in the frame.

## Mobile

- One primary action per screen, anchored in the bottom third for the thumb.
- Content starts at the top of the screen; no floating centred card on a
  background.
- A tab bar holds 3–5 destinations, not actions. Titles large and left-aligned or
  compact and centred — pick one pattern for the whole app.
- Touch targets at least 44 px; body 15–17 px.
- The frame is the screen: no drawn bezel, notch or home indicator.

## Brand still applies

Density is not an excuse for defaults. The direction's palette and type pairing
(`directions.md`) still set the voice — a grotesk display on the page titles and
big numbers, the tinted neutrals, the one accent. That is what makes a dense
screen look like a specific product instead of a component library demo.
