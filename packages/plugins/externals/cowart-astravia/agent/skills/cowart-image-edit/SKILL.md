---
name: cowart-image-edit
description: Revise a Cowart canvas image from an annotation screenshot using Astravia edit_image, then place the result with Cowart MCP. Use when the user submits a Cowart annotation edit or asks to clean up an annotated screenshot into a revised bitmap beside the original.
---

# Cowart Image Edit (Astravia)

## Astravia image tools (required)

| Intent | Tool |
|--------|------|
| Modify existing image / apply annotation marks | **`edit_image`** |
| Brand-new image with no source to revise | **`generate_image`** (use `cowart-image-gen` skill) |

Do **not** use an `imagegen` skill. After `edit_image` writes a file, place it with Cowart MCP `insert_cowart_image`.

## Workflow

1. Obtain the annotation screenshot (user attachment or Cowart-exported capture path from the follow-up prompt).

2. Call **`edit_image`** with that screenshot (and original image if available) so the model applies annotated intent and removes annotation chrome (arrows, scribbles, labels) unless the user wants them kept.

3. Place the result with MCP **`insert_cowart_image`** **beside** the original when possible (`placement: "right"`); do not delete or move the original unless asked.

4. Use `projectDir` = active user workspace for all Cowart MCP calls.

## Constraints

- Prefer **`edit_image`** for the bitmap step, then Cowart MCP for placement.
- If selection tools are available, `get_cowart_selection` can help locate the target image.
