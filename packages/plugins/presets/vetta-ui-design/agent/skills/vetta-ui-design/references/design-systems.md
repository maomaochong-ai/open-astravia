# Design systems (built-in templates)

The plugin bundles curated design systems (Linear, Stripe, Notion, Apple,
Spotify, …), each a hand-tuned `theme.css` + `DESIGN.md`. The catalog may
grow — never hardcode the list; call `vetd_design_systems` to see it.

- **Starting a new design and the user named no style**: call
  `vetd_design_systems` (no args) for the catalog, shortlist 2-4 that fit the
  request, then call it again with `present: [ids]` — the user picks from
  preview cards (or skips templates). Wait for their choice; don't pick for
  them.
- **The user described a vibe but named no system** ("make it feel premium",
  "像个开发者工具"): shortlist by the blurbs and `present` your best matches.
- **The user named a system** ("Linear 风"): call
  `vetd_design_systems({ apply: "<id>" })` directly.
- Apply on an empty design writes `theme.css` + `DESIGN.md` for you — do NOT
  rewrite them afterwards; just build frames that follow `DESIGN.md`. Apply on
  a design with frames backs everything up, writes `DESIGN.md`, and returns
  restyle instructions — execute them.
- Multi-screen requests are one flow (e.g. login → home → detail): plan the
  frame set first, put shared UI in `components/`, keep one visual language
  across all of them.

