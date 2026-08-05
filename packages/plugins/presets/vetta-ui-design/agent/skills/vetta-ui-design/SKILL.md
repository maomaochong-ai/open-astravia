---
name: vetta-ui-design
description: Build and edit design documents (.vetd) on the Vetta design canvas — app screens, landing pages, slides, posters, infographics. Use when the user asks for a UI design, mockup, screen, deck, poster, or attaches a design frame/element from the canvas. Frames are real React (TSX) files with Tailwind v4 + Iconify — edit them directly and the canvas hot-reloads.
agent_mode: work
---

# Vetta UI Design

A design document is a `.vetd` manifest plus a sidecar source dir `<name>.vetd.d/`:

```text
login-app.vetd          ← canvas manifest (frame positions/sizes). NEVER edit this.
login-app.vetd.d/
  frames/               ← one TSX file = one canvas frame
    login.tsx
    dashboard.tsx
  components/           ← shared React components (imported by frames)
  assets/               ← static assets (import with a relative path)
  theme.css             ← shared color system (Tailwind v4 @theme tokens)
  DESIGN.md             ← optional. If present, it OVERRIDES the presets below.
```

The canvas watches the sidecar dir: every file save hot-reloads instantly. The
plugin is the only writer of the `.vetd` manifest — you create/edit/delete
files under `<name>.vetd.d/` and the canvas reconciles automatically.

A frame is just a fixed-size canvas rendering a React component. UI screens are
the common case, not the only one — see "Pick the product type" below.

## Hard rules (mechanics — never negotiable)

1. **Never edit the `.vetd` manifest.** Frame positions belong to the user's
   canvas. Your channel is the sidecar sources only.
2. **Every frame file declares its meta** as the FIRST statement:
   ```tsx
   export const frame = { width: 390, height: 844, title: "登录" };
   ```
   It is read with a regex, so keep it on ONE line, flat (numbers + a plain
   string), with no comments and no nested objects — a parse miss silently
   falls back to 800x600. This is the frame's declared size: the canvas uses it
   for initial placement and follows it when you change it. Current
   user-adjusted size arrives in attachments — trust that over the meta.
3. **Default-export exactly one component** per frame file. It renders
   edge-to-edge inside the frame; use `h-full` layouts, no page margins.
4. **Use the shared theme tokens** from `theme.css` (`bg-primary`,
   `text-surface-foreground`, …) for anything brand/surface colored, so the
   whole document reskin-s from one place. Add new tokens to the `@theme`
   block instead of hardcoding hex values across frames.
5. **Icons come from Iconify Tailwind classes**:
   `<span className="icon-[lucide--search] size-4" />`. Bundled offline sets:
   `lucide`, `tabler`, `mdi`, `simple-icons` (brand logos). Prefer these.
6. Extract repeated UI into `components/` and import with relative paths
   (`../components/Button`). Frames may import each other's components but not
   other frames.
7. **Never point an `<img>` (or `background-image`) at a remote URL.** Images go
   in `assets/` and are imported relatively
   (`import hero from "../assets/hero.png"`); otherwise use a CSS gradient, a
   solid token color, or an Iconify glyph as the placeholder.
   This is not a style preference. Screenshots (canvas thumbnails, "让 Vetta
   调整", 导出渲染图) must re-`fetch` every image and inline it as a data URL —
   the browser cannot export a canvas tainted by a cross-origin image. So a
   remote URL that renders perfectly on screen will still:
   - **fail** the shot whenever `fetch` can't get it (CDN without CORS headers,
     404, offline) — that image comes out blank, and the failure is cached for
     the rest of the frame's life;
   - **slow it down** by a full network round trip per image; a frame with
     dozens of remote images turns a ~100ms shot into seconds.

   Local assets are served same-origin by the engine dev server and have
   neither problem.
8. TypeScript + Tailwind v4 utilities only; no extra npm dependencies (the
   shared engine has react/react-dom + react-router + Tailwind + Iconify —
   nothing else).
   Animations: Tailwind transitions/keyframes or hand-rolled CSS.
   **No web fonts** — only the system font stack is available. Build type
   contrast with size/weight/tracking, not typeface choice.
9. **Frame id = file basename = its route.** Create a frame by writing
   `frames/<kebab-id>.tsx`; delete one by deleting that file (the canvas
   reconciles). Rename the title via the meta, not the manifest.
   `frames/login.tsx` is the route `/login`, and `frames/index.tsx` is the site
   root `/` — see "Interaction & navigation".

## Before you write

- New document: call `vetd_create` (it scaffolds and opens the canvas). Never
  scaffold the manifest by hand. It creates NO frames — the canvas deliberately
  starts empty rather than guessing a size, so decide the product type first
  (below) and write the frames yourself.
- Existing document: call `vetd_status` first for the frame ids and sizes, read
  `theme.css`, and list `components/`. Reuse what is there — do not invent a
  second button or a second shade of the brand color.
- Read `DESIGN.md` if it exists. It is the design's own spec and outranks every
  default in this file. If its frontmatter has `system: <id>`, a built-in
  design system is applied: `theme.css` is that system's hand-tuned palette —
  do not casually rewrite token values; ADD tokens when you need new ones, and
  never rename or remove the base seven (`primary`, `primary-foreground`,
  `surface`, `surface-foreground`, `muted`, `accent`, `danger`).

## Design systems (built-in templates)

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

## Pick the product type

Judge from the request, then apply that preset. These are DEFAULTS — an
explicit user instruction always wins.

| Product | Default size | What matters |
| --- | --- | --- |
| Mobile screen | 390x844 | One primary action per screen; thumb-reachable controls; full state coverage |
| Desktop app / dashboard | 1440x900 | Real information density; aligned grid; no giant empty middle |
| Landing page | 1440x{2000+} | Clear hero → proof → CTA rhythm; section-level pacing |
| Slide | 1920x1080 | One idea per slide; large type; generous margins |
| Poster / social image | 1080x1440 (or 1080x1080) | A single visual focal point; strong size contrast; few words |
| Infographic / chart | free | Honest data, labeled axes, legible legend |

Do not default to a phone frame. A dashboard rendered at 390 wide is the most
common failure here.

## Interaction & navigation

A design document is also a runnable app: each frame is a real route, and the
user can hit "预览" on the canvas to click through it (or open the same URL in
their system browser). Design for that — a screen where nothing responds to a
click is an unfinished screen.

**Routes.** One frame = one route, derived from the file name:
`frames/login.tsx` → `/login`. `frames/index.tsx` is special — it is the site
root `/`. For any multi-screen product, make the entry screen `index.tsx` so
`/` lands somewhere sensible.

**Navigating between frames** uses react-router, imported from `react-router`:

```tsx
import { Link, useNavigate } from "react-router";

<Link to="/dashboard" className="...">登录</Link>;
// or, when the click does something first:
const navigate = useNavigate();
<button type="button" onClick={() => navigate("/dashboard")}>登录</button>;
```

**How much interaction to write** — by product type:

- **Mobile screen / desktop app / dashboard / landing page**: wire it up.
  `useState` for tabs, accordions, dropdowns, modals, form fields, toggles,
  filters; `<Link>`/`navigate()` for anything that moves between screens. When
  the user asked for a flow (login → home → detail), the flow must actually be
  clickable end to end.
- **Slide / poster / social image / infographic / chart**: do NOT add
  interaction. They are static artwork; state hooks there are pure noise.

Keep it honest and local: real component state, no fake backends, no timers
pretending to load forever. A submit button navigates to the next screen; it
does not need an API.

Note the canvas itself stays in design mode — clicking a frame there selects
elements for editing, which is why interaction is verified in preview (or by
reading the code), not by clicking the canvas.

## Quality bar

Applies to everything; the preset above adds emphasis, it does not replace this.

- **Spacing** on one consistent scale (Tailwind's default 4px steps). No
  arbitrary `mt-[13px]`.
- **Type**: at most 4 sizes per frame, with a visible weight/size gap between
  levels. If two levels look similar, merge them.
- **Color**: theme tokens only. One accent, used sparingly. Check text/background
  contrast — light gray on white is the second most common failure.
- **Corners, borders, shadows** consistent across the whole document.
- **Real content**: plausible names, prices, dates, copy — never Lorem ipsum or
  `Item 1 / Item 2`. Write copy in the language the user is using.
- **States**: for interactive UI, cover hover/disabled, and design the empty and
  loading cases when the screen can have them. (Skip for posters/slides.)
  Where a state is reachable by clicking, make it real rather than drawing a
  second frame for it — see "Interaction & navigation".
- **Icons must match meaning** — do not reach for a random glyph to fill space.

## Editing from a canvas attachment

When the user attaches a frame or DOM element, the attachment contains the
sources dir, the frame file, and — for elements — the exact
`frames/xxx.tsx:LINE` source location plus DOM path/classes/text. Edit that
location directly. If the location points into `components/`, the change
affects every frame using that component — mention this when it matters.

## Verify visually

Screenshotting is not optional. Call `vetd_screenshot` with the frame id, then
Read the returned PNG path to SEE the result:

- always after creating a frame,
- after any change that moves layout,
- for every frame you touched, before you report back.

Looking at the capture, check: content overflowing or clipped at the frame
edge, misaligned columns, text truncation, unreadable contrast, and whether the
frame actually fills its height. Fix and re-shoot rather than describing what
you intended.

Use `vetd_status` to list frame ids, check the design engine, and read recent
build output when something fails to render.

If a frame fails to compile, the canvas keeps showing its last good rendering
with a "build failed" badge, and `vetd_screenshot` returns the compile error
instead of an image (`vetd_status` reports it as `buildError` on the frame).
Fix the source and screenshot again — never declare a frame done while it
still reports a build error.

## Frame skeleton

```tsx
export const frame = { width: 390, height: 844, title: "登录" };

export default function Frame() {
	return (
		<div className="flex h-full flex-col bg-surface text-surface-foreground">
			{/* content */}
		</div>
	);
}
```
