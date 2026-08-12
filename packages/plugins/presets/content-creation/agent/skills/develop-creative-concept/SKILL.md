---
name: develop-creative-concept
description: Develop a vague content request into a reviewable creative strategy, big idea, treatment, script spine, visual system, and acceptance criteria before image or video production. Use when the user has a goal, product, theme, or audience but no concrete image, scene, campaign concept, narrative, or production-ready brief; also use to compare creative directions before building a workflow.
agent_mode: work
---

# Develop a creative concept

Do not create generation nodes until the concept is concrete enough to evaluate. Use `$operate-content-workflow` to inspect existing project context and save the accepted direction in the workflow objective.

## Development loop

1. Normalize the problem: objective, audience, desired response, publishing surface, deliverables, constraints, references, and proof of success.
2. Find the strategic tension: current belief or behavior versus the change the content must create.
3. Produce 2-4 genuinely different concept territories, each with one governing promise and one visual mechanism.
4. Compare them on strategic fit, distinctiveness, visual executability, extensibility, continuity risk, and production cost.
5. Develop the selected territory into a treatment, beat spine, visual system, sound idea, final image, and production assumptions.
6. Hand image work to `$direct-image-creation`, video work to `$direct-video-creation`, or a multi-asset system to `$create-content-campaign`.

Read [references/creative-brief-and-strategy.md](references/creative-brief-and-strategy.md) for any request. Read [references/concept-generation-and-selection.md](references/concept-generation-and-selection.md) when proposing or comparing directions. Read [references/treatment-script-and-beats.md](references/treatment-script-and-beats.md) before handing a concept into video or campaign production.

## Output contract

Return the normalized brief, concept territories, recommendation with tradeoffs, selected treatment if a direction is chosen, non-negotiable visual anchors, unresolved production decisions, and explicit next-stage acceptance criteria. Keep a concept distinct from a prompt: prompts are downstream execution artifacts.

This method is an original Vetta adaptation informed by visual-skills by Serge Shima (CC BY 4.0, https://github.com/smixs/visual-skills) and Generative-Media-Skills (MIT).
