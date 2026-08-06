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

The output is a running front-end app the user can click through in 预览, built
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
export const frame = { width: 390, height: 844, title: "登录" };
```

Omit `width`/`height` and the frame still reaches the canvas — rendered at a
size inferred from the rest of the design — but that is a guess, and `issues`
will keep asking. Sizes come from the product type below; when the design
already has frames, `vetd_status` lists their sizes — match them unless the new
screen is a different product type.

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
- Icons are Iconify classes: `<span className="icon-[lucide--search] size-4" />`.
  Never your own icon component, never inline SVG paths. Offline sets: `lucide`,
  `tabler`, `mdi`, `simple-icons`.
- `<Link to>` from react-router for internal screens, never `<a href="/…">`, and
  never a locally redefined `Link`/`useNavigate`/`useLocation`.
- No remote image URLs (`<img>`, `background-image`) — they break screenshots.
  Import from `assets/`, or use a gradient/token color/Iconify glyph.
- Normal formatting, one element per line for nested markup. Everything on one
  line destroys element→source mapping, and the user's "让 Vetta 调整" then
  points every element at the same line.
- One default export per frame, rendering edge-to-edge — no page margins.
- Only react, react-router, Tailwind v4 and Iconify are installed. No web fonts
  — build contrast with size/weight/tracking.

### The one thing nothing catches: a token that does not exist

Theme tokens in `className` (`bg-primary`, `text-muted`) instead of hex — but
**the token must exist in `theme.css` `@theme`**. Tailwind generates nothing for
a class it cannot resolve, so `bg-brand` without `--color-brand` leaves the
element with no background at all. Same mechanism as a blank icon: the source
reads perfectly, and nothing renders. Add the token first, then use it.

## Pick the product type

DEFAULTS — an explicit user instruction always wins. Do not default to a phone
frame; a dashboard at 390 wide is the most common failure.

| Product | Default size | What matters |
| --- | --- | --- |
| Mobile screen | 390x844 | One primary action; thumb reach; full state coverage |
| Desktop app / dashboard | 1440x900 | Real density; aligned grid; no empty middle |
| Landing page | 1440x{2000+} | hero → proof → CTA rhythm |
| Slide | 1920x1080 | One idea; large type; generous margins |
| Poster / social | 1080x1440 or 1080x1080 | One focal point; strong size contrast |
| Infographic / chart | free | Honest data, labeled axes, legible legend |

## Templates

Start from these three. They are the shape the checker expects; deviating from
them is how the mechanical `issues` above get triggered.

```tsx
// frames/products.tsx — a screen is composition, nothing structural
export const frame = { width: 1440, height: 900, title: "商品" };

import { StatCard } from "../components/StatCard";

export default function Products() {
	return (
		<div className="flex h-full flex-col gap-6 bg-surface p-8 text-surface-foreground">
			<h1 className="text-xl font-semibold">商品</h1>
			<div className="grid grid-cols-4 gap-4">
				<StatCard label="在售" value="1,284" />
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
	{ to: "/", label: "概览", icon: "icon-[lucide--layout-dashboard]" },
	{ to: "/products", label: "商品", icon: "icon-[lucide--package]" },
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

**New document**: `vetd_create` → pick the product type → settle the style.
The plugin ships curated design systems (Linear, Stripe, Notion, Apple, …), each
a hand-tuned `theme.css` + `DESIGN.md`; `vetd_design_systems` lists them and its
own description explains the three usages. Two judgment calls it cannot make for
you: when the user named a system outright, apply it directly; when they only
described a vibe ("像个开发者工具", "make it feel premium"), shortlist 2-4 by
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

**Editing from an attachment**: the payload carries the exact
`frames/xxx.tsx:LINE` plus DOM path/classes/text. Edit that location. If it
points into `components/`, the change hits every frame using it — say so.

**Done** means: every frame you touched has been screenshotted and the image
Read, that image is free of the three screenshot defects, and `issues` came back
empty. At that point stop and report — do not keep polishing. If something is
still off but you have already revised it twice, say what it is instead of
attempting a third pass.

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
