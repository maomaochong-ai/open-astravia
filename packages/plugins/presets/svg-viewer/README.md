# SVG Viewer Plugin

A trusted Vetta **system plugin** (ADR-0024) that previews `.svg` files in the
activity panel file preview, demonstrating the **file preview slot**
(`ui.slot.file-preview`).

Features:
- Rendered / source toggle
- Zoom controls over a checkerboard backdrop
- Renders via a `data:` URL (scripts inside the SVG do not execute)

`svg` is intentionally removed from the host's built-in image preview set so this
plugin can claim it (the file preview slot is "fill the blanks" only — plugins
cannot override built-in previews).

## System plugin

This lives under `packages/plugins/presets/`, so it ships with the app as a
system plugin (auto-enabled, permissions auto-granted, users cannot delete or
modify it). It is built by `bun run build:presets` from `apps/desktop`
(run automatically by `dev` / `start` / packaging); no manual install needed.

Install dependencies from the monorepo root, then build from this directory:

```bash
cd ../../../..
bun install
cd packages/plugins/presets/svg-viewer
bun run build   # writes dist/ and release/svg-viewer-<version>.zip
```

Desktop development and packaging consume the generated zip. Run
`bun run build:presets` from `apps/desktop` to validate and extract it
to the development system-plugin staging directory.
