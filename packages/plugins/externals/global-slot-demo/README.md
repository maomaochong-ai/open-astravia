# Global Slot Demo Plugin

This example demonstrates a trusted desktop UI plugin that renders through Vetta's global slot.
It also shows a TypeScript system prompt provider, skill paths, tool policies,
a JS-registered agent tool, and an opt-in continuation provider.

## Build

```bash
cd packages/plugins/externals/global-slot-demo
bun install --cwd ../..
bun run build
```

The installable archive is written to:

```text
packages/plugins/externals/global-slot-demo/release/global-slot-demo-0.1.0.vettapkg
```

The archive contains only runtime files required by the desktop host. Module Federation build metadata remains in `dist/` for diagnostics, but is not included in the zip.
`@vetta-org/plugin-vite` creates the archive automatically after `vite build`; no separate packaging script is required.

## Install From Renderer DevTools

After opening the desktop app, run:

```js
const file = await window.showOpenFilePicker({
  types: [{ description: "Vetta plugin", accept: { "application/vnd.vetta.plugin+zip": [".vettapkg"] } }]
});
const buffer = await (await file[0].getFile()).arrayBuffer();
await window.vetta.plugins.installFromArchive(buffer, {
  grantedPermissions: [
    "ui.slot.global",
    "agent.systemPrompt.write",
    "agent.skills.control",
    "agent.tools.control",
    "agent.tools.register",
    "agent.toolHandler.execute",
    "agent.continuation.register",
    "fs.read",
    "fs.write"
  ]
});
await window.vetta.plugins.setEnabled("global-slot-demo", true);
```

The settings page can also install and enable the generated zip from the plugin management UI.

## Notes

- The plugin is built as a Module Federation remote and exposes `./plugin`.
- `@vetta-org/plugin-vite` supplies the default Vite Module Federation and Rollup configuration for Vetta plugins.
- `src/index.tsx` registers `fiction-system-prompt` with `ctx.agent.registerSystemPromptProvider(...)`.
  - The provider runs before every Agent run and receives current plugin settings, session, model, conversation, runtime tool, and trigger snapshots.
  - It demonstrates all five prompt operations: add, replace, update, disable, and remove.
  - Operations run in returned order. Replace can create the target when add is off, update only changes an existing target, and remove runs last.
- `plugin.json` declares the static agent resources:
  - `agent.skillPaths` contributes `agent/skills/fiction-outline/SKILL.md` to the skill loader.
  - `agent.toolPolicy.deny` hides `doc_to_pdf` from the active tool set as a low-risk example.
- `src/index.tsx` registers `novel_write_chapter_file` at activation time. The tool schema is authored with `@sinclair/typebox`, and the handler writes through the host-controlled `api.fs.writeFile(...)` bridge.
- `src/index.tsx` registers `fiction-next-step` with `ctx.agent.registerContinuationProvider(...)`. It is disabled by default through the `continuationDemoEnabled` plugin setting. When enabled, it injects one short next-step request per session and uses `idempotencyKey` to prevent duplicate continuation.
- Tailwind CSS is compiled inside the plugin through `@tailwindcss/vite`; only utilities are imported, so the plugin does not inject Tailwind Preflight into the host.
- React is shared by the desktop host through Module Federation, so it is a plugin development dependency only.
- `@vetta-org/plugin-sdk` is provided by the host and remains external.
- The plugin declares `ui.slot.global`, `agent.systemPrompt.write`, `agent.skills.control`, `agent.tools.control`, `agent.tools.register`, `agent.toolHandler.execute`, `agent.continuation.register`, `fs.read`, and `fs.write`; without these grants, the corresponding UI, agent contribution, tool registration, continuation provider, or file operation is ignored.
- Tailwind classes reference Vetta CSS variables such as `--primary` and `--popover`, so the plugin follows the active host theme.
