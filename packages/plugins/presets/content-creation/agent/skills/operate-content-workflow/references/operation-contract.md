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

## Import local media before binding it

Local file paths are host resources, not workflow sources. Use `content_creation_assets` with `action="list"` to inspect a directory, then `action="import"` with explicit file paths. Import returns an `assetNodeId`, asset IDs, and one `generationSources` entry per imported asset. Select exactly the entries required by the intent: one image for `animate-still`, two ordered images for `interpolate-frames`, or intentional references for `reference-guided`. Never put a filesystem path in `sourceNodeId` and never call `animate-still` with an empty or unfiltered `sources[]`.

Directory import defaults to `directoryMode="select-one"` and returns candidates when several media files exist. Set `directoryMode="all"` only when the request intentionally needs a collection. Local discovery and import use only host-authorized roots; do not attempt to bypass a path authorization error.

## Describe the outcome first

Update workflow metadata so the project remains understandable without chat history:

- `title`: short human-readable project name;
- `objective`: audience, surface, creative intent, constraints, and acceptance criteria;
- `deliverables`: output type, source node, and exact expected artifact.

Every generator node should have a purpose that states its role and changed variable, for example `9:16 hook variant - faster product reveal`.

## Choose prompt ownership deliberately

A generator already owns its effective prompt, so a Prompt node is never required merely to make an image or video node runnable.

- Put single-use subject, shot, transition, camera, lighting, timing, and negative constraints directly on the generator through its `prompt` or method-specific `promptPlan`.
- Add a Prompt node only when one **verbatim shared fragment** must be resolved by at least two consumers and one later edit must update every consumer. Typical examples are a locked brand voice paragraph, a character identity block, or a campaign-wide negative constraint.
- Do not centralize per-shot differences. Keep changed action, framing, endpoint state, duration, and strategy-specific direction on each generator.
- Do not create one Prompt node per generator, a Prompt node with zero consumers, or an automatic Prompt node with only one consumer. `readiness` reports the single-consumer automatic case as `agent-prompt-node-not-reused`.
- When a reusable Prompt node and local generator text coexist, connect the shared node through `targetInput="promptSources"`; the generator-local text remains the method-specific suffix.

Decision test: if deleting the Prompt node and copying its text into one generator would not create duplicate maintenance work, keep the text inline.

## Build valid graph shapes

- Text to image: generator-local prompt (plus an optional reused Prompt node) -> image generator -> output.
- Image to video: generator-local prompt (plus an optional reused Prompt node) and image asset/generator -> video generator -> output.
- Shared art direction: one prompt may feed multiple intentional variants.
- Multi-shot sequence: use timestamped stages inside one video prompt only when the inspected mode supports them; otherwise create separate shot nodes and record their intended order in purposes or workflow metadata.
- Multiple formats: separate output or generator nodes when ratio, duration, or prompt must differ.

Describe the intended topology and use `afterNodeId` only as a locality hint when useful. The edit service owns incremental canvas layout; never synthesize coordinates. Preserve existing IDs and edges during local changes. Set `modelSelection="automatic"` unless inspected requirements justify a specific provider/model/mode. Connect ordinary topology with `sourceNodeId`, `targetNodeId`, optional `edgeId`, and semantic `targetInput` values (`promptSources`, `referenceImages`, `contentSources`, or `mediaSources`) instead of legacy `source` / `target` names or internal handles. Use `bind_assets` to select concrete image-generator references.

Video media inputs are a generation plan, not generic graph edges. Prefer one high-level `configure_video_shot` operation with `targetNodeId` set to the receiving video-generator. It selects and validates a strategy before compiling to the same capability-backed roles. Use low-level `configure_generation` only for legacy or targeted role repair. Put source image/video node IDs in `sources[]`; never use a source node as `targetNodeId`:

- `text-to-video`: no sources;
- `animate-still`: exactly one image source, treated as the initial composition/frame;
- `interpolate-frames`: exactly two distinct image sources, optionally labelled `firstFrame` and `lastFrame`; never degrade this to a one-frame mode;
- `reference-guided`: one or more sources, with explicit roles when the default type role is not sufficient (`referenceImages`, `referenceVideos`, or `referenceAudios`);
- `transform-video`: exactly one video source.

For asset nodes, include non-empty `assetIds` selected from that node. For image/video generator nodes, provide only `sourceNodeId` so the downstream node consumes the future generated output. `configure_generation` resolves only configured model capabilities and atomically replaces the target's prior media roles, bindings, provider, model, and mode. If no compatible configured model exists, change the plan or report the missing capability; do not fall back to raw `connect_nodes`.

For `configure_video_shot`:

- use the method-specific `text-to-video-plan`, `animate-still-plan`, `first-last-frame-plan`, `omni-reference-plan`, or `transform-video-plan`; the plan kind must agree with the resolved strategy;
- use `strategy="automatic"` unless the user explicitly chooses a supported method, but still select the prompt plan kind from the creative authority contract;
- set `controlRequirements.exactEnding=true` only when an independent last-frame image must be authoritative; this requires both keyframe plans, selects first/last-frame, and never degrades to `animate-still`;
- keep `exactEnding=false` when the request only needs a deliberate stable finish; express that editorial result in `promptPlan.finalState`;
- provide `keyframes.first` and `keyframes.last` as distinct image-generator nodes with matching `image-keyframe` phases;
- keep identity, subject count, environment, camera axis, aspect ratio, and light direction compatible across both keyframes;
- for omni-reference, assign every source a unique `alias`, a semantic role (`identity`, `product`, `environment`, `style`, `composition`, `end`, `motion`, or `audio`), and a concrete instruction;
- declare `requiresSceneReference=true` for choreography or spatial interaction whose environment must remain authoritative.

### First/last-frame execution contract

First/last-frame is a three-stage dependency chain, not two unrelated stills followed by an arbitrary video mode:

```text
first image generator (own valid authorities) --referenceImages--> last image generator (image-to-image)
             |                                                         |
             +--firstFrame--> video generator <--lastFrame-------------+
                               (image-to-video interpolation)
```

Submit the two image nodes and one `configure_video_shot` operation. Do not add any of these media edges manually. The operation atomically:

1. preserves the first generator's existing intentional text or media authorities and compiles its first frozen-state plan;
2. clears stale non-prompt media references from the last generator;
3. fixes the last generator to `image-to-image`, makes the first generator's future output its sole visual reference, and compiles the last frozen-state edit plan;
4. selects only a video model mode that declares both `firstFrame` and `lastFrame` input slots;
5. binds the two generated images to those exact roles and preserves their shared aspect ratio.

The runtime follows graph dependencies, so execution order is first image, last image, then video. The last image prompt must describe the final frozen state and the delta from the supplied first image. The generated first image—not duplicated prose—is the authority for identity, geometry, environment, camera axis, lens/framing, materials, palette, and light direction. The video plan then describes only the continuous physical path between the two endpoint images.

The following are invalid and block preparation:

- first and last images generated independently;
- a last-frame generator without the first-frame `referenceImages` dependency;
- last frame not using `image-to-image`, or a first frame whose own configured references are incompatible with its selected image mode;
- video using animate-still, omni-reference, text-to-video, or any mode without both frame slots;
- only one endpoint, duplicate endpoint nodes, identical endpoint states, incompatible aspect ratios, or conflicting continuity fields.

Repair these with one complete `configure_video_shot` operation. Do not patch the graph with `connect_nodes` or switch to another strategy to silence validation.

## Edit in coherent batches

Keep a batch focused on one understandable change, but include newly created nodes and all intended connections in the same batch. Do not add a raw media connection that duplicates a source or keyframe owned by `configure_video_shot`; redundant legacy connections are ignored only as a recovery measure. Reusable Prompt-node connections are ordinary topology and the compiled directing plan is appended after their dynamic content. The edit tool validates and applies the complete revision-bound batch atomically without a confirmation step. A failure leaves project state unchanged; inspect again after revision conflicts.

For Agent-authored video prompts, submit the strategy-specific video plan instead of a raw `prompt` or legacy generic `video-shot` plan. For generated first/last frames, use `image-keyframe` plans: these record frozen visible state, composition, camera axis, environment, light direction, and continuity anchors, while the `first-last-frame-plan` records only continuous transition logic. The edit service compiles and validates all three prompts atomically. Existing user-authored prompts remain editable in the UI; only Agent changes are gated.

Supported operation families for this skill are workflow updates, node add/update/rename/purpose/duplicate/delete, semantic edge connect/delete, concrete image asset binding, and intent-driven video generation configuration. Use only fields present in the tool schema.
