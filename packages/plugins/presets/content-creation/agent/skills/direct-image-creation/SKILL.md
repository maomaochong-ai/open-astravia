---
name: direct-image-creation
description: Turn a creative request into a production-ready AI image brief, reference plan, node workflow, and model-profile prompt. Use for text-to-image, surgical editing, exact text or infographics, image analysis and style transfer, sketch/wireframe or dimensional translation, product/food/fashion/portrait imagery, character sheets, presentation visuals, UI/social/poster assets, multi-panel grids, storyboards, visual variants, composition changes, or improving an image-generation node.
---

# Direct AI image creation

Use `$operate-content-workflow` for inspection and mutations. Capabilities are the source of truth for executable models and modes.

## Route the task

1. Inspect project state, references, and image capabilities.
2. If no concrete visual concept exists, invoke `$develop-creative-concept` before authoring prompts.
3. Classify the request as new generation, edit, variation, composition transfer, character/product continuity, or multi-asset set.
4. Define the brief and acceptance criteria before creating nodes.
5. Generate a small candidate set when direction is uncertain; select before producing expensive derivatives.
6. Review the actual output with `$review-content-quality` and repair the smallest failing dimension.

Read only the references needed:

- Any prompt: read [references/model-prompt-profiles.md](references/model-prompt-profiles.md), then [references/prompt-framework.md](references/prompt-framework.md)
- Ready-to-fill prompt structures: [references/production-prompt-skeletons.md](references/production-prompt-skeletons.md)
- Editing or reference continuity: [references/editing-and-continuity.md](references/editing-and-continuity.md)
- Model/mode choice: [references/model-routing.md](references/model-routing.md)
- Exact text, infographic, diagram, or localization: [references/text-and-information-design.md](references/text-and-information-design.md)
- Recreate, analyze, or transfer an attached visual: [references/visual-decomposition.md](references/visual-decomposition.md)
- Sketch, wireframe, floor plan, or 2D/3D translation: [references/structural-and-dimensional-control.md](references/structural-and-dimensional-control.md)
- Grid, collage, contact sheet, comic, or storyboard sheet: [references/multi-panel-and-sequential.md](references/multi-panel-and-sequential.md)
- Slide visual: [references/presentation-visuals.md](references/presentation-visuals.md)
- Product, character, storyboard, or social patterns: [references/task-patterns.md](references/task-patterns.md)
- Commerce, product, food, or beverage: [references/commerce-and-food-patterns.md](references/commerce-and-food-patterns.md)
- Fashion, portrait, or character design: [references/fashion-portrait-and-character-patterns.md](references/fashion-portrait-and-character-patterns.md)
- Poster, illustration, UI mockup, or social asset: [references/poster-ui-and-social-patterns.md](references/poster-ui-and-social-patterns.md)
- Output review: [references/quality-checklist.md](references/quality-checklist.md)

## Brief requirements

Record purpose, audience, publishing surface, aspect ratio, subject, action/pose, environment, composition, lighting, palette, medium, references and their roles, immutable details, exclusions, deliverables, and acceptance criteria. Distinguish hard constraints from preferences.

Prefer an explicit visual decision over a pile of adjectives. Make each variation change one named axis such as composition, palette, lens, pose, or rendering medium.

This method is an original Vetta adaptation informed by Generative-Media-Skills (MIT), visual-skills by Serge Shima (CC BY 4.0, https://github.com/smixs/visual-skills), and ViMax (MIT).
