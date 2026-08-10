# Workflow operation contract

## Inspect narrowly

- `summary`: identity, workflow, counts, and currently selected nodes.
- `project`: graph and timeline data before structural edits.
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
- Multi-shot sequence: separate shot nodes, then add successful sources to the timeline in narrative order.
- Multiple formats: separate output or generator nodes when ratio, duration, or prompt must differ.

Use `afterNodeId` or automatic placement. Preserve existing IDs and edges during local changes. Set `modelSelection="automatic"` unless inspected requirements justify a specific provider/model/mode.

## Edit in coherent batches

Keep a batch focused on one understandable change. The edit tool applies up to six non-destructive commands directly. It returns a preview instead when the batch is destructive or broader than that boundary. A preview is a pending proposal, not project state.

Supported operation families include workflow updates, node add/update/rename/purpose/duplicate/delete, edge connect/delete, and timeline clip insertion. Use only fields present in the tool schema.
