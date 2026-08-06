---
name: vetta-ui-design
description: "Build and edit design documents (.vetd) on the Vetta design canvas — app screens, landing pages, slides, posters, infographics. Use when the user asks for a UI design, mockup, screen, deck, or poster, or attaches a design frame/element from the canvas. Frames are real React (TSX) routes, not pictures."
agent_mode: work
---

# Vetta UI Design

```text
login-app.vetd          ← canvas manifest (positions/sizes). NEVER edit.
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
automatically. Every save hot-reloads the canvas.

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

## Hard rules

1. **Never edit the `.vetd` manifest.** Your channel is the sidecar sources.
2. **Frame meta is the FIRST statement**, one flat line (regex-parsed):
   `export const frame = { width: 390, height: 844, title: "登录" };`
   Omit `width`/`height` and the frame still reaches the canvas — it is rendered
   at a size inferred from the rest of the design — but that is a guess, and
   `issues` will keep asking you to declare the real one. Sizes come from the
   product type below; when the design already has frames, `vetd_status` lists
   their sizes — match them unless the new screen is a different product type.
3. **One default-exported component per frame**, rendering edge-to-edge — no
   page margins.
4. **Frame id = file basename = route.** Create/delete a frame by writing or
   deleting `frames/<kebab-id>.tsx`.
5. **No extra npm dependencies.** Available: react, react-router, Tailwind v4,
   Iconify. No web fonts — build contrast with size/weight/tracking.

### Checked mechanically — copy the templates and these never come up

A checker parses every source you write. Violations come back as `issues` on
`vetd_screenshot` and `vetd_status`, naming the file and line. The templates
below are already correct on all of them:

- `h-full`, never `h-screen`/`min-h-screen` — a frame is a fixed-size canvas,
  not a viewport.
- Icons are Iconify classes: `<span className="icon-[lucide--search] size-4" />`.
  Never your own icon component, never inline SVG paths. Offline sets: `lucide`,
  `tabler`, `mdi`, `simple-icons`.
- Theme tokens in `className`, never a hex color. Add tokens to `theme.css`
  `@theme` instead of hardcoding.
- `<Link to>` from react-router for internal screens, never `<a href="/…">`, and
  never a locally redefined `Link`/`useNavigate`/`useLocation`.
- No remote image URLs (`<img>`, `background-image`) — they break screenshots.
  Import from `assets/`, or use a gradient/token color/Iconify glyph.
- Normal formatting, one element per line for nested markup. Everything on one
  line destroys element→source mapping, and the user's "让 Vetta 调整" then
  points every element at the same line.

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

**New document**: `vetd_create` → pick the product type → if the user named no
style, see `references/design-systems.md`.

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
**unintended text wrapping**, and **blank icons**. A frame that does not parse
returns the syntax error instead of an image — fix the reported line and
screenshot again.

**Check the structure**: for a UI product with more than one screen, or with
chrome that repeats across screens, read `references/self-check.md` before
reporting back. It carries the four things the checker cannot see.

**Editing from an attachment**: the payload carries the exact
`frames/xxx.tsx:LINE` plus DOM path/classes/text. Edit that location. If it
points into `components/`, the change hits every frame using it — say so.

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
| `references/self-check.md` | Checking a multi-screen UI before reporting back |
| `references/quality.md` | Reviewing a screenshot; before declaring any frame done |
| `references/design-systems.md` | Starting a new design, or restyling one |
