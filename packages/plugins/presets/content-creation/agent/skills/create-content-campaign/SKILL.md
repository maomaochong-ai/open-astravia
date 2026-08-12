---
name: create-content-campaign
description: Plan and build a coherent multi-asset image/video content campaign from a brief, including concept candidates, authority assets, hero selection, derivative assets, shots, and delivery formats. Use for product launches, brand or logo systems, ecommerce listing packs, ad creative sets, social packs, character or portrait packs, cinematic product films, UGC-style ads, storyboard-to-video work, or any request with several related deliverables.
agent_mode: work
---

# Create a content campaign

Orchestrate `$develop-creative-concept`, `$direct-image-creation`, `$direct-video-creation`, `$review-content-quality`, and `$operate-content-workflow`. Build an inspectable production plan before quota-consuming generation.

## Stage gates

1. Normalize the brief. If the request has no accepted creative territory, use `$develop-creative-concept` before selecting a production recipe.
2. Select a recipe from [references/recipe-catalog.md](references/recipe-catalog.md), apply [references/scenario-composition.md](references/scenario-composition.md) when combining specialized image/video recipes, and create workflow metadata plus named stage/asset nodes.
3. Produce a small set of concept candidates that differ on one meaningful hypothesis.
4. Review and select a master direction using [references/selection-and-gates.md](references/selection-and-gates.md).
5. Generate dependent stills, keyframes, or proof shots from the approved master.
6. Expand into final shots, formats, timestamped generation prompts, and an ordered sequence manifest only after upstream gates pass.
7. Audit completeness, continuity, safe areas, format, and delivery readiness.

Read [references/production-planning.md](references/production-planning.md) before creating a campaign graph. Keep approval boundaries visible as nodes, purposes, and run batches. Do not hide an entire campaign inside one generator prompt.

## Cost and risk rules

- Explore cheaply, select deliberately, render expensively.
- Fan out independent derivatives only after their shared dependency is approved.
- Reuse approved masters and continuity ledgers; do not recreate identity or product direction independently.
- Prepare separate runs when the user may reasonably approve one stage but reject the next.
- A generated file is not complete until it passes its delivery gate.

This method is an original Vetta adaptation informed by Generative-Media-Skills (MIT), visual-skills by Serge Shima (CC BY 4.0), and ViMax (MIT).
