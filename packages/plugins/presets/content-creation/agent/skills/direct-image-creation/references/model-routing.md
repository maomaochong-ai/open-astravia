# Image model routing

Inspect `content_creation_inspect(view="capabilities")` before selecting a provider, model, or mode. Route by requirements, not reputation or model name.

## Match hard constraints first

1. Output kind is image.
2. Mode supports new generation or the required edit/reference behavior.
3. Required reference count and named slots are available.
4. Aspect ratio and resolution satisfy the publishing surface.
5. The mode supports required text, transparency, or multi-image conditioning when those capabilities are explicitly reported.
6. Cost/latency preference fits the iteration stage.

Use automatic selection when the user has no provider requirement and the workflow expresses the real constraints. Use specific selection only with IDs returned by the capability inspection.

## Route by stage

- Direction exploration: fast/low-cost candidate mode.
- Identity or product lock: reference-capable edit/conditioning mode.
- Hero output: highest suitable quality after direction approval.
- Derivative sizes: edit or variation mode that preserves the approved master.

If no mode satisfies every hard constraint, expose the conflict and offer the smallest relaxation. Never silently omit a reference, ratio, or preservation requirement.
