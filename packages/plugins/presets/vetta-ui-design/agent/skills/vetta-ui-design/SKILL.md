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
2. **Navigation** — `import { Link, useNavigate } from "react-router"`. Never
   hand-roll a `Link`, and never use a bare `<a href>` for an internal screen.
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
   `width` and `height` are REQUIRED — there is no default size. A frame missing
   either one never reaches the canvas: `vetd_status` reports it and
   `vetd_screenshot` refuses. Sizes come from the product type below; when the
   design already has frames, `vetd_status` lists their sizes — match them
   unless the new screen is a different product type.
3. **One default-exported component per frame**, rendering edge-to-edge —
   `h-full` layouts, no page margins, no `min-h-screen`.
4. **Frame id = file basename = route.** Create/delete a frame by writing or
   deleting `frames/<kebab-id>.tsx`.
5. **Icons are Iconify classes**: `<span className="icon-[lucide--search] size-4" />`.
   Never write your own icon component or inline SVG paths. Offline sets:
   `lucide`, `tabler`, `mdi`, `simple-icons`.
6. **Theme tokens for anything brand/surface colored.** Add tokens to `@theme`
   rather than hardcoding hex across frames.
7. **No remote image URLs** (`<img>`, `background-image`). Import from
   `assets/`, or use a gradient/token color/Iconify glyph. Remote URLs break
   screenshots — see `references/quality.md`.
8. **No extra npm dependencies.** Available: react, react-router, Tailwind v4,
   Iconify. No web fonts — build contrast with size/weight/tracking.
9. **Write readable code**: normal formatting, one element per line for
   anything nested. Everything-on-one-line breaks element→source mapping, and
   the user's "让 Vetta 调整" then points every element at the same line.

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

## Workflow

**New document**: `vetd_create` → pick the product type → if the user named no
style, see `references/design-systems.md` → write shared parts → write frames.

**Existing document**: `vetd_status` FIRST. It returns the frame ids/sizes,
`sharedShell` (existing `_layout.tsx` + `components/` — reuse them), `issues`
(mechanical rule violations found in your sources) and `buildError`s. Read
`theme.css` and reuse what is there.

**`issues` are not advisory.** They are things a checker proved wrong about the
code you wrote — fix them before reporting back. Each one names the rule and,
when relevant, the reference to read.

**Check the structure**: when the design is a UI product with more than one
screen, or has chrome that repeats across screens (nav bar / sidebar / tab bar),
read `references/self-check.md` before reporting back and run its checklist
against your own files. It carries the reference architecture to compare with —
half the list is mechanical and comes back via `issues`, the other half only you
can see. Skip it for posters, slides and single-screen designs.

**Verify visually**: call `vetd_screenshot` for EVERY frame you created or
changed, then Read the returned PNG to actually see it. You are looking for
rendering defects the code cannot show you — run the screenshot checklist in
`references/quality.md`, which starts with the three that account for most of
them: **misalignment**, **unintended text wrapping**, and **blank icons**. A
frame with a `buildError` returns the compile error instead of an image — never
declare it done in that state.

**Editing from an attachment**: the payload carries the exact
`frames/xxx.tsx:LINE` plus DOM path/classes/text. Edit that location. If it
points into `components/`, the change hits every frame using it — say so.

## References (read on demand)

Resolve against `$SKILL_DIR`. Do not read them all up front.

| File | Read it when |
| --- | --- |
| `references/interaction.md` | Wiring clicks, `_layout.tsx`, cross-screen flows |
| `references/self-check.md` | Checking a multi-screen UI before reporting back |
| `references/quality.md` | Reviewing a screenshot; before declaring any frame done |
| `references/design-systems.md` | Starting a new design, or restyling one |

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
