---
name: remotion-video
description: Create, modify, and render Remotion React video projects in the current Vetta conversation workspace. Use for requests to make programmatic videos, motion graphics, animated explainers, social videos, data videos, or to edit an existing Remotion composition and export it as MP4.
---

# Remotion Video

Treat the current workspace root as the Remotion project. Do not create another project directory inside it.

## Workflow

1. Inspect `package.json`, `src/`, `public/`, and existing compositions before editing.
2. If no project exists, create a standard TypeScript Remotion project directly in the workspace root.
3. Install dependencies with `npm install`. Vetta Desktop guarantees managed Node and npm; do not assume Bun is available to the packaged app.
4. Build or edit compositions using normal Remotion React APIs.
5. Call `render_remotion_video` with the exact Composition id after the source is complete.
6. Report the returned `out/*.mp4` path. Do not claim the render succeeded unless the tool returns `ok: true`.

## New project baseline

Use exact matching Remotion versions. The supported baseline is `4.0.507`:

```json
{
  "name": "remotion-video",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "studio": "remotion studio src/index.ts",
    "render": "remotion render src/index.ts Main out/main.mp4"
  },
  "dependencies": {
    "@remotion/cli": "4.0.507",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "remotion": "4.0.507"
  },
  "devDependencies": {
    "@types/react": "^19.1.1",
    "@types/react-dom": "^19.1.1",
    "typescript": "^5.9.2"
  }
}
```

Create `src/index.ts` with `registerRoot()`, a root component that registers at least one `<Composition>`, composition modules under `src/`, `public/` for media, and `out/` for renders. Preserve an existing project's versions and structure instead of replacing them with this baseline.

## Composition rules

- Drive animation with `useCurrentFrame()`, `interpolate()`, `spring()`, `<Sequence>`, and other deterministic Remotion APIs.
- Use `staticFile()` for files under `public/`.
- Keep width, height, fps, and duration explicit on each Composition unless `calculateMetadata()` intentionally computes them.
- Pass the same JSON props through the render tool that the Composition expects.
- Keep `remotion.config.ts` when present. The renderer calls the project-local Remotion CLI, so normal CLI configuration and installed Remotion extensions continue to apply.
- Install any additional package imported by the composition before rendering.

## Rendering

Use:

```text
render_remotion_video({
  compositionId: "Main",
  inputProps: {},
  outputName: "main.mp4"
})
```

`entryPoint` defaults to `src/index.ts`. The renderer writes only MP4/H.264 output in this version. Fix source, dependency, or Composition errors reported by the tool and retry; do not bypass the plugin by inventing a different render pipeline.

