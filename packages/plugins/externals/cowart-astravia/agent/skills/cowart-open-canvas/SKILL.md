---
name: cowart-open-canvas
description: Open the Cowart infinite canvas (tldraw) in Astravia Desktop. Use when the user asks to open, launch, view, or work in the Cowart canvas or wants an infinite canvas for visual planning/image work.
---

# Cowart Open Canvas (Astravia 1:1)

## Host mapping

| Codex | Astravia |
|-------|--------|
| MCP App widget (`ui://widget/...`) | Activity panel tab with full tldraw `App` |
| `window.cowartMcp` bridge | Plugin installs the same bridge via `ctx.fs` + `conversation.sendPrompt` |
| Canvas files under project | `<projectDir>/canvas/` (shared with MCP tools) |

## Workflow

1. Call plugin tool `open_cowart_canvas` (opens the Cowart activity tab at max width).
2. Optionally call MCP `render_cowart_canvas_widget` with `projectDir` = **user workspace** to confirm storage paths.
3. Canvas data:

```text
canvas/cowart-canvas.json
canvas/pages/<page-id>/cowart-canvas.json
canvas/pages/<page-id>/assets/
canvas/cowart-selection.json
canvas/cowart-view-state.json
```

4. User draws/annotates in the panel. Agent uses MCP tools (`get_cowart_*`, `insert_cowart_image`, …) for programmatic canvas IO. UI AI actions send follow-up prompts into the active conversation.

## Image tools (when UI / user asks for bitmaps)

| Intent | Tool |
|--------|------|
| New image | **`generate_image`** |
| Edit / annotation revise | **`edit_image`** |

Then place with MCP `insert_cowart_image`. Do not use an `imagegen` skill.

## Constraints

- Never pass the plugin install directory as `projectDir`.
- Prefer `open_cowart_canvas` for the interactive UI; MCP tools remain available for agent-side canvas edits.
