---
name: review-content-quality
description: Evaluate generated images and videos against their creative brief, delivery requirements, continuity rules, and technical quality, then propose the smallest evidence-based repair. Use when the user asks whether an output is good, requests critique or selection among variants, reports weak or broken media, or before expanding an approved direction into more assets.
---

# Review content quality

Judge the rendered artifact, not the prompt's intention. Use `$operate-content-workflow` to inspect objective, node purpose, references, capabilities, runtime, and diagnostics. If the actual pixels or frames are unavailable, state that visual quality cannot be verified and limit conclusions to workflow/runtime evidence.

## Review sequence

1. Restate the artifact's job, surface, hard constraints, and continuity anchors.
2. Apply must-pass gates before scoring creative polish.
3. Inspect the actual image at delivery size or sample the video across beginning, middle, end, and critical transitions.
4. Separate observed evidence from inferred cause.
5. Return a verdict: approve, approve with minor repair, regenerate with targeted change, or blocked by capability/input.
6. Propose one primary repair and preserve what already works.

Read [references/image-rubric.md](references/image-rubric.md) for images, [references/video-rubric.md](references/video-rubric.md) for video, and [references/repair-policy.md](references/repair-policy.md) before proposing another generation.
Read [references/scenario-gates.md](references/scenario-gates.md) for logos and brand systems, ecommerce/product sets, identity or try-on work, spatial/UI designs, social assets, UGC, product films, action/tutorial sequences, or clipped highlights.

## Output contract

Report: verdict, must-pass failures, strongest qualities, evidence by rubric dimension, primary cause hypothesis, next change, and invariants to preserve. For variants, rank them against the same criteria and explain the tradeoff; do not average away a hard failure.

This method is an original Vetta adaptation informed by visual-skills by Serge Shima (CC BY 4.0) and ViMax (MIT).
