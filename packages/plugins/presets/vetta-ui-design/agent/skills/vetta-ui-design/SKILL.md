---
name: vetta-ui-design
description: "Build and edit design documents (.vetd) on the Vetta design canvas — app screens, landing pages, slides, posters, infographics. Use when the user asks for a UI design, mockup, screen, deck, or poster, or attaches a design frame/element from the canvas. Frames are real React (TSX) routes, not pictures."
agent_mode: work
---

# Vetta UI Design

```text
login-app.vetd          ← canvas manifest. GENERATED — see below.
login-app.vetd.d/
  frames/               ← one TSX file = one canvas frame = one route
    index.tsx           ← the site root "/"
    login.tsx           ← "/login"
    _layout.tsx         ← optional shared shell; `_` files are NOT frames
  components/           ← shared React components
  assets/               ← images, imported relatively
  theme.css             ← color/radius/shadow tokens (Tailwind v4 @theme)
  DESIGN.md             ← optional spec; OVERRIDES defaults in this skill
```

You write the sidecar sources; the plugin owns the manifest and reconciles
automatically. Every save hot-reloads the canvas. Two consequences worth
internalising before you start:

- **The file name IS the route and the frame id.** Create a screen by writing
  `frames/<kebab-id>.tsx`, delete one by deleting the file. There is no
  registration step anywhere.
- **Editing the `.vetd` manifest is pointless, not just forbidden.** It is
  regenerated from your tsx declarations on every save, so any hand-edit is
  overwritten seconds later. If a frame is not showing up the way you expect,
  the answer is always in the tsx.

## It is a project, not a picture

The output is a running front-end app the user can click through in preview, built
from sources meant to ship. Decide structure BEFORE writing screens:

1. **Routes** — `frames/login.tsx` is `/login`, `index.tsx` is `/`.
2. **Navigation** — `import { Link, useNavigate } from "react-router"`.
3. **Shared chrome written once** — nav bar / sidebar / tab bar goes in
   `components/`, or in `frames/_layout.tsx` rendering `<Outlet />` when it must
   survive navigation. Never paste it into each frame.
4. **Shared vocabulary** — colors/radii/shadows from `theme.css` tokens
   (`bg-primary`, not `#0d99ff`); repeated blocks become components.

If changing the nav bar means editing more than one file, the structure is
wrong. Posters, slides and infographics are standalone artwork — steps 1-3 do
not apply to them.

## The one rule you have to hold in your head

**Frame meta is the FIRST statement**, one flat line (regex-parsed):

```tsx
export const frame = { width: 390, height: 844, title: "Login" };
```

Every frame declares its own. Omit it and the frame is rendered at a size
inferred from the rest of the design — it still reaches the canvas, but nothing
about that size is yours, and `issues` will keep asking until you declare one.
Sizes come from the product type below; when the design already has frames,
`vetd_status` lists their sizes and the design's `defaultFrameSize` — match them
unless the new screen is a different product type.

It gets its own section because it is the only convention here that needs
judgment from you. Everything else is either caught automatically or visible in
the render.

### Caught for you — copy the templates and these never come up

A checker parses every source you write; violations come back as `issues` on
`vetd_screenshot` and `vetd_status`, naming the file and line. A file that does
not parse, or that imports a package the engine does not have, comes back the
same way. The templates below are already correct on all of it:

- `h-full`, never `h-screen`/`min-h-screen` — a frame is a fixed-size canvas,
  not a viewport.
- Icons are Iconify classes — a `<span>` with a class, NOT a component:
  `<span className="icon-[lucide--search] size-4" />`. There is no icon package
  to import: `import { Search } from "lucide-react"` fails to build, and so does
  every other icon library. Never your own icon component, never inline SVG
  paths. Offline sets, and only these: `lucide`, `tabler`, `mdi`,
  `simple-icons` — naming any other set fails to build too.
- `<Link to>` from react-router for internal screens, never `<a href="/…">`, and
  never a locally redefined `Link`/`useNavigate`/`useLocation`.
- No remote image URLs (`<img>`, `background-image`) — they break screenshots.
  Import from `assets/`, or use a gradient/token color/Iconify glyph.
- Normal formatting, one element per line for nested markup. Everything on one
  line destroys element→source mapping, and the user's "Ask Vetta" edits then
  point every element at the same line.
- One default export per frame, rendering edge-to-edge — no page margins.
- Only react, react-router, Tailwind v4 and Iconify are installed, and you
  cannot add a dependency — the engine is a fixed template, there is no install
  step anywhere. A chart, a date picker, an animation library: build it from
  Tailwind utilities, an Iconify glyph and plain React state, or leave it out.
  No web fonts — build contrast with size/weight/tracking.

### The one thing nothing catches: a token that does not exist

Theme tokens in `className` (`bg-primary`, `text-muted`) instead of hex — but
**the token must exist in `theme.css` `@theme`**. Tailwind generates nothing for
a class it cannot resolve, so `bg-brand` without `--color-brand` leaves the
element with no background at all. Same mechanism as a blank icon: the source
reads perfectly, and nothing renders. Add the token first, then use it.

## Pick the product type

This is the first decision, not an afterthought: `vetd_create` requires it
(`product`, or `frameSize` in pixels for anything the enum cannot express), and
it becomes the design's default size. Read it off the user's own words, in
whatever language they wrote them — a phone app is `mobile`, an admin console or
dashboard is `desktop`. An explicit user instruction always wins. Do not default to a phone frame; a dashboard at 390 wide is the
most common failure.

| Product | `product` | Default size | What matters |
| --- | --- | --- | --- |
| Mobile screen | `mobile` | 390x844 | One primary action; thumb reach; full state coverage |
| Desktop app / dashboard | `desktop` | 1440x900 | Real density; aligned grid; no empty middle |
| Landing page | `landing` | 1440x2400 | hero → proof → CTA rhythm |
| Slide | `slide` | 1920x1080 | One idea; large type; generous margins |
| Poster / social | `poster` | 1080x1440 | One focal point; strong size contrast |
| Square social post | — | `frameSize` 1080x1080 | One focal point; strong size contrast |
| Infographic / chart | — | `frameSize`, free | Honest data, labeled axes, legible legend |
| Print (A4 portrait) | — | `frameSize` 794x1123 @96dpi, 2480x3508 @300dpi | Convert mm→px yourself; 300dpi only when the user asks for print |

The design default only covers frames that forgot to declare a size. A document
can mix product types — a poster next to three phone screens — as long as each
frame declares its own.

## Templates

Start from these three. They are the shape the checker expects; deviating from
them is how the mechanical `issues` above get triggered.

Their copy is English only because this file is; it says nothing about which
language to design in. Frame titles and every label inside a frame go in the
language the USER is writing to you in — same rule as your own replies.

```tsx
// frames/products.tsx — a screen is composition, nothing structural
export const frame = { width: 1440, height: 900, title: "Products" };

import { StatCard } from "../components/StatCard";

export default function Products() {
	return (
		<div className="flex h-full flex-col gap-6 bg-surface p-8 text-surface-foreground">
			<h1 className="text-xl font-semibold">Products</h1>
			<div className="grid grid-cols-4 gap-4">
				<StatCard label="In stock" value="1,284" />
			</div>
		</div>
	);
}
```

```tsx
// frames/_layout.tsx — the shell, mounted once, renders <Outlet /> itself.
// `h-full` here too: this wraps the frame, it is not a page.
import { Outlet, useLocation } from "react-router";
import { NavBar } from "../components/NavBar";

export default function Layout() {
	const { pathname } = useLocation();
	// Screens outside the app shell (login, onboarding) opt out here.
	if (pathname === "/login") return <Outlet />;
	return (
		<div className="flex h-full flex-col bg-surface">
			<NavBar />
			<div className="min-h-0 flex-1 overflow-auto">
				<Outlet />
			</div>
		</div>
	);
}
```

```tsx
// components/NavBar.tsx — the ONLY definition of this chrome
import { Link, useLocation } from "react-router";

const items = [
	{ to: "/", label: "Overview", icon: "icon-[lucide--layout-dashboard]" },
	{ to: "/products", label: "Products", icon: "icon-[lucide--package]" },
];

export function NavBar() {
	const { pathname } = useLocation();
	return (
		<nav className="flex items-center gap-1 border-b border-border px-4 py-2">
			{items.map((item) => (
				<Link
					key={item.to}
					to={item.to}
					className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
						pathname === item.to ? "bg-primary/10 text-primary" : "text-muted"
					}`}
				>
					<span className={`${item.icon} size-4`} />
					{item.label}
				</Link>
			))}
		</nav>
	);
}
```

## Workflow

**New document**: pick the product type → `vetd_create` with it → settle the
style.
The plugin ships curated design systems (Linear, Stripe, Notion, Apple, …), each
a hand-tuned `theme.css` + `DESIGN.md`; `vetd_design_systems` lists them and its
own description explains the three usages. Two judgment calls it cannot make for
you: when the user named a system outright, apply it directly; when they only
described a vibe ("like a developer tool", "make it feel premium"), shortlist 2-4 by
the blurbs and `present` them rather than picking silently. Applying on an empty
design writes `theme.css` + `DESIGN.md` for you — do NOT rewrite them
afterwards, just build frames that follow `DESIGN.md`.

**Existing document**: `vetd_status` ONCE first. It returns the frame ids/sizes,
`sharedShell` (existing `_layout.tsx` + `components/` — reuse them) and
`issues`. Read `theme.css` and reuse what is there. You do not need to call it
again afterwards — `vetd_screenshot` returns `issues` per frame.

Then, for a multi-screen product, write in two passes:

1. **Skeleton pass.** Write the shared parts (`_layout.tsx`, `components/`),
   then EVERY frame as a short file: the `frame` meta line plus the page's
   structural blocks — header, the grid, section placeholders. A few dozen lines
   each. The whole set lands on the canvas within seconds, so the user sees the
   screen inventory and the layout immediately, and a wrong size or a wrong
   route shows up before you have written any detail.
2. **Detail pass, one frame at a time.** Fill in real content for one frame,
   then `vetd_screenshot` it, then move to the next. Each save hot-reloads, so
   the design fills in visibly instead of appearing all at once at the end.

Single screens, posters and slides skip the skeleton pass — just write the file.

**Verify visually**: `vetd_screenshot` every frame you created or changed, then
Read the returned PNG to actually see it. You are looking for rendering defects
the code cannot show you — run the checklist in `references/quality.md`, which
starts with the three that account for most of them: **misalignment**,
**unintended text wrapping**, and **classes that resolve to nothing** (a blank
icon, or a surface whose theme token was never defined). A frame that does not parse
returns the syntax error instead of an image — fix the reported line and
screenshot again.

Nothing will remind you. Writing a file tells you it was written, not that it
renders — the checker only speaks through `vetd_screenshot` and `vetd_status`,
and neither runs by itself. A frame you wrote but never screenshotted may be
sitting on the canvas as a build error or at a size you never chose, and the
turn will end that way: the user is looking at the canvas, so they see it and
you do not. Writing several frames in a row without a single screenshot is how
that happens; the detail pass exists to prevent it.

**Check the structure**: for a UI product with more than one screen, or with
chrome that repeats across screens, answer these four before reporting back.
They are the ones no checker can see; skip them for posters, slides and
single-screen designs.

1. **Chrome defined once?** Grep for the nav bar's markup — it must appear in
   exactly one file. Two frames both containing the sidebar means extract it.
2. **Shell survives navigation?** Persistent chrome belongs in
   `frames/_layout.tsx`. Per-frame `AppShell` is acceptable only combined with
   `<Link>` navigation, otherwise nothing persists at all.
3. **Props actually match?** Nothing typechecks these sources at runtime, so a
   renamed prop fails silently — a component taking `name` but always called
   with `icon` renders one fallback everywhere, and the source reads fine.
4. **Every touched frame screenshotted, and the PNG actually Read?**

**User notes on the canvas**: the user pins Figma-style notes onto frames (or
onto empty canvas) — each is a request addressed to you. `vetd_notes` lists the
pending ones: every note carries its thread, a source anchor re-resolved at read
time (`element.source` = `frames/x.tsx:LINE` — the authoritative edit target
unless `anchorStale`), and per-frame screenshots where numbered pins mark the
exact spots. Take them **one at a time**: edit for one note, verify it with
`vetd_screenshot`, then immediately `resolve` that one note before you start the
next — never hold the replies back until every note is done. The user is watching
the canvas, where each bubble flips to resolved the moment you reply, and a turn
that dies halfway has to leave the finished ones already marked. That reply is
what marks a note handled; never touch `.notes.json` yourself. Notes reach you three ways: the
user sends an explicit "handle my notes" prompt, `vetd_status` reports a
`pendingNotes` count, and `vetd_screenshot` flags pending notes on the frame it
just shot.

Notes are also how the user talks to you **while you are working**: rather than
interrupt your turn with a new message, they pin the request onto the canvas and
let you pick it up. So a note can appear at any moment, including after your last
screenshot — which is exactly why the Done check below runs `vetd_notes`
unconditionally instead of waiting for some tool response to mention one.

Every instruction the user gives from the canvas becomes a note, including the
ones sent to you as a message right away — those arrive with a `noteId` in the
attached selection context (see below). So when the Done check turns up a
pending note, first look at whether its `id` is the one you were just handed: if
so it is the request you have already been working on, not new work. Either way
you finish by replying through `vetd_notes`'s `resolve`, which is what puts your
answer back on the canvas where the user asked and clears the pending badge.

**Editing from an attachment**: when the user asks a question from the canvas
with something selected, that selection rides along as structured context
(`vetta.ui-design.canvas-selection`), and it describes **that message only** —
one frame with its absolute `file`, and for an element selection the exact
`frames/xxx.tsx:LINE` in `source` plus DOM path/classes/text. Read every
`screenshot` path it carries before editing (it normally carries one; if it
doesn't, `vetd_screenshot` what you need). Edit that location. If it points into
`components/`, the change hits every frame using it — say so. The context also
carries `noteId`: the same request is pinned on the canvas as that note, so
`resolve` it when you are done rather than counting it as work you never started.

**Done** means: every frame you touched has been screenshotted and the image
Read, that image is free of the three screenshot defects, `issues` came back
empty, and no user note is left pending — always run `vetd_notes` once before
reporting back, even if nothing this turn mentioned notes, and address whatever
is still pending. Not one of those three is checked for you at the end of the turn — if you
report back without them, whatever is broken simply stays broken. So before you
report, name the frames you touched and confirm each one cleared all three.

At that point stop and report — do not keep polishing. If something is still off
but you have already revised it twice, say what it is instead of attempting a
third pass.

## Do not rework

Rewriting your own output is the single largest waste in this workflow, and it
buys nothing: a revision made without looking at the render is a guess.

- **Never re-read a file you just wrote.** Its contents are already in context.
- **Fix with `edit`, never by rewriting the whole file with `write`.** Both the
  `issues` and the build errors you get back name a file and a line; go there.
  A full rewrite costs many times more and usually introduces a new defect.
- **Screenshot before revising.** Once a frame is written, the next thing you do
  to it is `vetd_screenshot`. Do not polish it first — you cannot see what is
  wrong yet. One frame, one revision pass per screenshot.
- **Do not restate the plan between steps.** A todo list is worth it only when
  the design has more screens than you can hold at once.

## References (read on demand)

Resolve against `$SKILL_DIR`. Do not read them all up front.

| File | Read it when |
| --- | --- |
| `references/interaction.md` | Wiring clicks, `_layout.tsx`, cross-screen flows |
| `references/quality.md` | Reviewing a screenshot; before declaring any frame done |
