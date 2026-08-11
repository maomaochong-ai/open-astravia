# Video workflow patterns

## Product launch

1. Brand/product direction prompt.
2. Hero image generator for approved composition.
3. Video generator using the hero image as a start/reference image.
4. Output node describing platform, ratio, and duration.

Use this pattern when product geometry and branding must remain stable.

## Multi-shot story

1. Shared direction prompt.
2. Per-shot prompts with explicit purposes.
3. Per-shot image generators when continuity needs reference frames.
4. Per-shot video generators.
5. Output generation nodes and a narrative-order sequence manifest.

Do not ask one generation node to create an edited sequence unless the selected model explicitly supports that behavior.

## Social variation set

Reuse a shared prompt and references, then create separate generator nodes for aspect ratio, hook, or motion variations. Name the changed variable in each node purpose.

## Model routing

Inspect capabilities before assigning a model. Match, in order:

1. output kind;
2. input mode and named slots;
3. required/minimum references;
4. aspect-ratio policy;
5. supported duration and resolution;
6. optional audio behavior.

If no model satisfies all hard constraints, explain the conflicting constraint and offer the smallest change. Never silently drop a required reference or substitute an unsupported duration.
