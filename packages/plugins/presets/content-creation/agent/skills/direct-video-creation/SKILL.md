---
name: direct-video-creation
description: Turn a user's creative intent into a production-ready AI video brief, shot plan, node workflow, and generation prompts. Use for text-to-video, image-to-video, first/last-frame animation, reference-video transformation, product films, social videos, storyboards, camera-direction requests, or improving an existing video-generation node.
---

# Direct AI video creation

Use `$operate-content-workflow` for all inspection and mutations. This skill supplies creative decisions; runtime capabilities remain the source of truth for what can be executed.

## Build the brief

Infer safe defaults and record them in the workflow objective. Resolve only decisions that materially change the result:

- purpose, audience, and publishing surface;
- target duration and aspect ratio;
- subject, environment, visual style, and continuity anchors;
- required action, camera behavior, pacing, and audio intent;
- supplied reference media and non-negotiable constraints;
- final deliverables and success criteria.

For detailed prompt construction, read [references/prompting.md](references/prompting.md). For graph patterns and model routing, read [references/workflow-patterns.md](references/workflow-patterns.md). Before recommending regeneration, read [references/quality-checklist.md](references/quality-checklist.md).

## Plan shots before generating

Keep each generation node focused on one short, visually coherent shot. For multi-shot requests:

1. Define a shared visual anchor prompt.
2. Create one prompt/generator pair per shot or intentional variation.
3. Reuse approved images as video start frames when identity or product consistency matters.
4. State transition intent in node purposes; do not hide the full edit plan inside one long generation prompt.
5. Add only executable nodes supported by current capabilities.

## Choose a generation mode

- Use text-to-video for exploration when no exact subject appearance must be preserved.
- Use image-to-video when composition, identity, product shape, lighting, or art direction already exists.
- Use first/last-frame behavior only when the inspected mode exposes distinct frame roles.
- Use reference-to-video or video-to-video only when the inspected input slots accept those assets.
- Prefer a short low-cost validation shot before a larger set when creative direction is uncertain.

## Preserve creative intent

Keep subject identity, wardrobe/product geometry, palette, lighting direction, lens language, motion energy, and environment rules consistent across related nodes. Change one major variable per iteration so the cause of improvement or regression remains understandable.
