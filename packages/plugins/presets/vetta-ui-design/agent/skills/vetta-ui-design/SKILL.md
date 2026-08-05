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
   other frames. Local images go in `assets/` and are imported relatively
   (`import hero from "../assets/hero.png"`). Remote URLs work but break
   offline — prefer local assets or CSS gradients.
7. TypeScript + Tailwind v4 utilities only; no extra npm dependencies (the
   shared engine has react/react-dom + Tailwind + Iconify — nothing else).
   Animations: Tailwind transitions/keyframes or hand-rolled CSS.
   **No web fonts** — only the system font stack is available. Build type
   contrast with size/weight/tracking, not typeface choice.
8. **Frame id = file basename.** Create a frame by writing
   `frames/<kebab-id>.tsx`; delete one by deleting that file (the canvas
   reconciles). Rename the title via the meta, not the manifest.

## Before you write

- New document: call `vetd_create` (it scaffolds and opens the canvas). Never
  scaffold the manifest by hand.
- Existing document: call `vetd_status` first for the frame ids and sizes, read
  `theme.css`, and list `components/`. Reuse what is there — do not invent a
  second button or a second shade of the brand color.
- Read `DESIGN.md` if it exists. It is the user's own spec and outranks every
  default in this file.
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
