---
name: cowart-image-gen
description: Generate a bitmap for the Cowart canvas via Astravia generate_image, then insert or replace via Cowart MCP. Use when the user asks to create, fill, replace, or place an AI-generated image on a Cowart canvas.
---

# Cowart Image Gen (Astravia)

## Astravia image tools (required)

| Intent | Tool |
|--------|------|
| Brand-new image / fill AI image holder / invent a scene | **`generate_image`** |
| Revise an existing image or annotation screenshot | **`edit_image`** (use `cowart-image-edit` skill) |

Do **not** use an `imagegen` skill or ad-hoc scripts. After the bitmap exists on disk, place it with Cowart MCP `insert_cowart_image`.

## Preconditions

Cowart MCP tools should be available (plugin **cowart-astravia** enabled). Prefer opening the canvas first (`open_cowart_canvas`).

## Workflow

1. Read selection with MCP `get_cowart_selection` (`projectDir` = user workspace).

2. If exactly one selected shape is an AI image holder (`isAiImageHolder` or `meta.cowartAiImageHolder`), use holder size (`props.w` / `props.h`) as the generation contract.

3. Call **`generate_image`** to produce the bitmap. Resolve the real local output path.

4. Call MCP **`insert_cowart_image`** with `projectDir` and that image path:
   - Holder selected → prefer **replace** the holder (`replaceAiImageHolder: true`).
   - Otherwise insert onto the current page (from view/canvas state).

## Constraints

- Pass **user projectDir**, not the plugin root.
- Keep original holders only if the user asks to preserve slots.
- Include target aspect ratio in the `generate_image` prompt when replacing a holder.
