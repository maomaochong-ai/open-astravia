# First/last-frame method

Use this method when one continuous shot must begin and end on two authoritative frozen states.

## Author three different plans

1. `keyframes.first.promptPlan` describes only the visible first frame as an `image-keyframe`.
2. `keyframes.last.promptPlan` describes only the visible last frame as an `image-keyframe`.
3. The video `first-last-frame-plan` describes only the temporal path between them.

Never reuse the video prompt as either image prompt. Never reuse one image prompt for both endpoints.

## Build the transition contract

- `continuity[]`: identity, subject count, environment, camera axis, scale, light direction, and other facts shared by both frames.
- `stateChanges[]`: visible differences that must occur between the endpoints.
- `physicalPath`: causal, chronological motion that can plausibly produce those differences.

Set `exactEnding=true` only because the last image is authoritative. A stable but freely generated final composition belongs in `finalState` with `exactEnding=false`.

## Feasibility gate

Reject or redesign endpoint pairs that disagree unintentionally on identity, subject count, environment, camera axis, scale, or light. Insert an intermediate shot instead of requesting an impossible morph.

```json
{
  "kind": "first-last-frame-plan",
  "transitionContract": {
    "continuity": ["same two dancers", "same ballroom", "same camera axis"],
    "stateChanges": ["dancer A crosses from left to center", "both dancers meet and hold eye contact"],
    "physicalPath": "A completes one flowing waltz phrase while the camera tracks laterally and settles as both subjects meet"
  }
}
```
