---
name: direct-video-creation
description: Turn creative intent into a production-ready AI video brief, treatment, script/beat plan, shot cards, animatic/keyframe plan, node workflow, and model-profile prompts. Use for text-to-video, image-to-video, multi-shot or dialogue scenes, reference-video transformation, video editing or continuation, product/logo/jewelry/fashion/social/UGC films, fight scenes, character stories, cooking tutorials, music videos, award or freeze effects, talking-character clips, drone or one-shot footage, long-form-to-short clipping plans, storyboards, prompt audits, camera/light/sound direction, race/chase/kinetic montage, or improving a video-generation node.
---

# Direct AI video creation

Use `$operate-content-workflow` for all inspection and mutations. This skill supplies creative decisions; runtime capabilities remain the source of truth for what can be executed.

## Route the task

1. Inspect the project and capabilities.
2. If no concept, story, or scene exists, invoke `$develop-creative-concept` first.
3. Classify the request as treatment/script, storyboard/animatic, text-to-video, image-to-video, reference transformation, edit/continuation, single shot, or multi-shot sequence.
4. Build the brief and shot plan before adding generation nodes.
5. Generate a low-cost proof shot when direction is uncertain; expand only after the direction is accepted.
6. Review the actual output with `$review-content-quality` before recommending a retry.

Read only the references needed for the task:

- Any video task: read [references/dramaturgy-and-shot-design.md](references/dramaturgy-and-shot-design.md), [references/prompting.md](references/prompting.md), then [references/model-prompt-profiles.md](references/model-prompt-profiles.md)
- Ready-to-fill generation structures: [references/production-prompt-skeletons.md](references/production-prompt-skeletons.md)
- Treatment, script, storyboard, edit plan, or prompt audit: [references/role-modes-and-output-contracts.md](references/role-modes-and-output-contracts.md)
- Any timestamped sequence, storyboard, multi-shot generation, pacing plan, or animatic: [references/generation-timeline-and-storyboard.md](references/generation-timeline-and-storyboard.md)
- Need concrete 5-30 second product, UGC, tutorial, action, dialogue, or continuous-shot prompt timelines: [references/generation-timeline-examples.md](references/generation-timeline-examples.md)
- Shot list, pacing, or montage timing: [references/shot-cards-and-rhythm.md](references/shot-cards-and-rhythm.md)
- Precise framing, movement, light, transition, and sound terms: [references/camera-light-sound-vocabulary.md](references/camera-light-sound-vocabulary.md)
- Multi-shot identity and reference handling: [references/continuity-and-references.md](references/continuity-and-references.md)
- Graph pattern and capability routing: [references/workflow-patterns.md](references/workflow-patterns.md)
- Genre or montage structure: [references/genre-and-montage-patterns.md](references/genre-and-montage-patterns.md)
- Still keyframes or animatic: [references/animatic-keyframes.md](references/animatic-keyframes.md)
- Race, chase, drift, or kinetic speed: read [references/animatic-keyframes.md](references/animatic-keyframes.md), then [references/kinetic-speed.md](references/kinetic-speed.md)
- Video-to-video edit, replacement, localization, or continuation: [references/video-editing-and-extension.md](references/video-editing-and-extension.md)
- Need to choose a specialized production recipe: [references/scenario-routing.md](references/scenario-routing.md)
- Multi-reference roles, timed beats, native audio, first/last frames, or instructional video prompting: [references/reference-role-and-timed-directing.md](references/reference-role-and-timed-directing.md)
- Product, jewelry, giant-product, ingredient-motion, commercial, or animated-logo video: [references/product-brand-and-logo-video-recipes.md](references/product-brand-and-logo-video-recipes.md)
- UGC, try-on, motion transfer, talking character, ceremony, freeze effect, or creator performance: [references/character-performance-and-ugc-video-recipes.md](references/character-performance-and-ugc-video-recipes.md)
- Fight, character story, storyboard-driven tutorial, cooking sequence, or music video: [references/narrative-action-and-tutorial-video-recipes.md](references/narrative-action-and-tutorial-video-recipes.md)
- Drone, one-shot, platform social video, or long-form clipping: [references/camera-social-and-clipping-video-recipes.md](references/camera-social-and-clipping-video-recipes.md)
- Output review: [references/quality-checklist.md](references/quality-checklist.md)
- Failed or weak output: [references/failure-repairs.md](references/failure-repairs.md)

## Brief requirements

Record purpose, audience, publishing surface, duration, ratio, subject, environment, style, continuity anchors, action, camera, pacing, audio intent, references, constraints, deliverables, and acceptance criteria. Infer reversible defaults; ask only when a missing choice changes cost, supplied references, or the core deliverable.

Keep each generator focused on one visually coherent shot unless the inspected mode explicitly supports multiple timestamped stages or shots in one generation. In that mode, put consecutive time windows inside the video prompt. Otherwise create independent shot nodes and return their intended order. Name the changed variable in every intentional variation.

## Choose a generation mode

- Use text-to-video for exploration when no exact subject appearance must be preserved.
- Use image-to-video when composition, identity, product shape, lighting, or art direction already exists.
- Use first/last-frame behavior only when the inspected mode exposes distinct frame roles.
- Use reference-to-video or video-to-video only when the inspected input slots accept those assets.
- Prefer a short low-cost validation shot before a larger set when creative direction is uncertain.

When materializing the plan on the canvas, use `$operate-content-workflow`'s `configure_generation` contract. Pass concrete asset IDs for asset collections, reference upstream image/video generators by future output, and let capability resolution compile those business roles to provider slots. Never express first frame, last frame, visual reference, motion reference, or source video as an unlabelled edge.

This method is an original Vetta adaptation informed by Generative-Media-Skills (MIT), visual-skills by Serge Shima (CC BY 4.0, https://github.com/smixs/visual-skills), and ViMax (MIT).
