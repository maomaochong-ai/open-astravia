# Transform-video method

Use one video as the temporal authority for an edit, restyle, replacement, motion transfer, localization, or continuation-like transformation supported by the inspected mode.

## Build the transformation contract

- `sourceTimeRange`: identify the whole clip or the exact affected interval.
- `preserve[]`: list timing, camera path, performance, blocking, identity, background, audio, or other source facts that must survive.
- `change[]`: list the smallest explicit set of changes.
- `temporalMapping`: explain how each change follows source timing and motion.

Describe the new visible result in the shared plan fields. For a continuation unsupported by a native endpoint, create a new shot beginning from the source final state instead of pretending the provider can extend the file.

## Failure prevention

- Never use “make it better” or “same video in another style” without a preserve/change split.
- Do not silently alter framing, timing, performance, or audio when they are intended source authorities.
- Bound replacements by object, region, and time span.
- If the request only borrows appearance from a video and does not preserve its timing, omni-reference may be the more accurate method.

```json
{
  "kind": "transform-video-plan",
  "transformationContract": {
    "sourceTimeRange": "the complete 0-6 second source clip",
    "preserve": ["performer timing", "camera path", "body motion", "background layout"],
    "change": ["replace the jacket with a red silk jacket"],
    "temporalMapping": "the replacement follows every fold, occlusion, and lighting change at the original frame timing"
  }
}
```
