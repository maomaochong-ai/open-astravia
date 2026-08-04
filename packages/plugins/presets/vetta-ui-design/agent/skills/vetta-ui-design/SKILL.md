---
name: vetta-ui-design
description: Build and edit UI design documents (.vetd) on the Vetta UI Design canvas. Use when the user asks for a UI design, mockup, screen, landing page, app interface, or attaches a design frame/element from the canvas. Frames are real React (TSX) files with Tailwind v4 + Iconify — edit them directly and the canvas hot-reloads.
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
  assets/               ← static assets
  theme.css             ← shared color system (Tailwind v4 @theme tokens)
```

The canvas watches the sidecar dir: every file save hot-reloads instantly. The
plugin is the only writer of the `.vetd` manifest — you create/edit/delete
files under `<name>.vetd.d/` and the canvas reconciles automatically.

## Hard rules

1. **Never edit the `.vetd` manifest.** Frame positions belong to the user's
   canvas. Your channel is the sidecar sources only.
2. **Every frame file declares its meta** as the FIRST statement:
   ```tsx
   export const frame = { width: 390, height: 844, title: "登录" };
   ```
   Keep it a flat literal (numbers + string). This is the frame's declared
   size: the canvas uses it for initial placement and follows it when you
   change it. Current user-adjusted size arrives in attachments — trust that
   over the meta.
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
7. TypeScript + Tailwind v4 utilities only; no extra npm dependencies (the
   shared engine has react/react-dom + Tailwind + Iconify — nothing else).
   Animations: Tailwind transitions/keyframes or hand-rolled CSS.

## Creating a design

Call the `vetd_create` tool (it scaffolds and opens the canvas), then write
frame files. Do not scaffold the manifest by hand.

## Editing from a canvas attachment

When the user attaches a frame or DOM element, the attachment contains the
sources dir, the frame file, and — for elements — the exact
`frames/xxx.tsx:LINE` source location plus DOM path/classes/text. Edit that
location directly. If the location points into `components/`, the change
affects every frame using that component — mention this when it matters.

## Verify visually

After meaningful changes, call `vetd_screenshot` with the frame id, then Read
the returned PNG path to SEE the result before declaring it done. Use
`vetd_status` to list frame ids, check the design engine, and read recent
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
