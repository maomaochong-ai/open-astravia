# Workflow operation contract

## Inspect narrowly

- `summary`: identity, workflow, counts, and currently selected nodes.
- `project`: graph data before structural edits.
- `graph`: semantic connections, connected components, and orphan node IDs.
- `readiness`: workflow status, runnable and blocked generators, orphan nodes, and actionable issues.
- `capabilities`: executable providers, models, modes, input slots, ratios, durations, and resolutions.
- `runtime`: active and historical jobs or runs.
- `diagnostics`: blocking validation failures and actionable warnings.

Inspect `project` before edits and pass its revision to `content_creation_edit`. Inspect `capabilities` before setting any provider-specific value. Never infer capability support from model names.

## Describe the outcome first

Update workflow metadata so the project remains understandable without chat history:

- `title`: short human-readable project name;
- `objective`: audience, surface, creative intent, constraints, and acceptance criteria;
- `deliverables`: output type, source node, and exact expected artifact.

Every generator node should have a purpose that states its role and changed variable, for example `9:16 hook variant - faster product reveal`.

## Build valid graph shapes

- Text to image: prompt -> image generator -> output.
- Image to video: prompt plus image asset/generator -> video generator -> output.
- Shared art direction: one prompt may feed multiple intentional variants.
- Multi-shot sequence: use timestamped stages inside one video prompt only when the inspected mode supports them; otherwise create separate shot nodes and record their intended order in purposes or workflow metadata.
- Multiple formats: separate output or generator nodes when ratio, duration, or prompt must differ.

Use `afterNodeId` or automatic placement. Preserve existing IDs and edges during local changes. Set `modelSelection="automatic"` unless inspected requirements justify a specific provider/model/mode. Connect ordinary topology with semantic `targetInput` values (`promptSources`, `referenceImages`, `contentSources`, or `mediaSources`) instead of internal handles. Use `bind_assets` to select concrete image-generator references.

Video media inputs are a generation plan, not generic graph edges. Use one `configure_generation` operation for the target video node:

- `text-to-video`: no sources;
- `animate-still`: exactly one image source, treated as the initial composition/frame;
- `interpolate-frames`: exactly two distinct image sources, optionally labelled `firstFrame` and `lastFrame`; never degrade this to a one-frame mode;
- `reference-guided`: one or more sources, with explicit roles when the default type role is not sufficient (`referenceImages`, `referenceVideos`, or `referenceAudios`);
- `transform-video`: exactly one video source.

For asset nodes, include non-empty `assetIds` selected from that node. For image/video generator nodes, provide only `sourceNodeId` so the downstream node consumes the future generated output. `configure_generation` resolves only configured model capabilities and atomically replaces the target's prior media roles, bindings, provider, model, and mode. If no compatible configured model exists, change the plan or report the missing capability; do not fall back to raw `connect_nodes`.

## Edit in coherent batches

Keep a batch focused on one understandable change, but include newly created nodes and all intended connections in the same batch. The edit tool validates and applies the complete revision-bound batch atomically without a confirmation step. A failure leaves project state unchanged; inspect again after revision conflicts.

Supported operation families for this skill are workflow updates, node add/update/rename/purpose/duplicate/delete, semantic edge connect/delete, concrete image asset binding, and intent-driven video generation configuration. Use only fields present in the tool schema.
