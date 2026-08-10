# Workflow discovery and execution

## Decide reuse versus creation

1. Inspect the current project summary and graph before proposing a new workflow.
2. Match the user's objective and deliverables against existing node purposes and outputs.
3. Reuse when an existing graph has the required artifact stages, input modes, and outputs and only needs parameter/reference changes.
4. Extend when the core graph is valid but lacks a bounded downstream stage.
5. Create a new graph when reuse would preserve wrong authorities, dependencies, or deliverables.

Explain the match in task terms, not by node count.

## Inspect required inputs

Before execution, identify every required value from graph data and inspected capabilities:

- prompts/briefs that cannot be inferred safely;
- source media and each reference role;
- required input slots and minimum counts;
- ratio, duration, resolution, and output kind;
- authority/master selections;
- external facts or exact copy;
- user approval gates.

Infer reversible creative defaults. Ask only for missing media, exact text/facts, a choice that changes the deliverable, or a cost-bearing branch.

## Build or edit

Translate the selected production recipe into named nodes with explicit purposes. Keep one shared direction/authority feeding assigned branches. Use current revision, coherent edit batches, automatic placement, and capability-backed model settings.

After edits, inspect diagnostics. Do not prepare a run while blocking errors remain.

## Prepare and confirm

`content_creation_run(action="prepare")` is a proposal boundary. Summarize the stages, expensive branches, expected outputs, and known capability limitations in the confirmation card. Do not describe a prepared run as started.

## Monitor and recover

- Poll status for the existing run ID; do not resubmit because progress is slow.
- On node failure, preserve succeeded siblings and classify the cause before retrying.
- On revision conflict, reinspect and rebuild only still-needed edits.
- On rejected/weak media, use `$review-content-quality`; runtime success is not creative approval.
- On cancellation, report completed and unstarted stages separately.

## Return outputs

Report each deliverable by purpose, node/asset, status, format, and review state. Surface partial results honestly. A missing optional variant does not erase a valid master; a missing required authority or final deliverable prevents campaign completion.

