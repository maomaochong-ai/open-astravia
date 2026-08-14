# First/last-frame method

Use this method only when one continuous shot must match two authoritative frozen endpoints. It is not “two similar prompts.” The visual dependency is first image (from its own intended authorities) -> edited last image -> interpolated video.

## Required topology and execution

1. Generate the first frame from `keyframes.first.promptPlan` and its own intentional authorities. This may be text-to-image or image-to-image when a supplied product, person, or scene reference must remain authoritative.
2. Feed the generated first-frame image into the last-frame image generator as its sole `referenceImages` authority.
3. Generate the last frame as `image-to-image` from `keyframes.last.promptPlan`. This is a controlled edit of the first frame, not a new composition sampled independently.
4. Feed the first image to the video mode's `firstFrame` slot and the derived last image to its `lastFrame` slot.
5. Generate video only with a mode that declares both slots. Never substitute animate-still, text-to-video, omni-reference, or a generic reference mode.

`configure_video_shot` owns the first-to-last dependency and both frame-to-video relationships, and establishes the dependency order atomically. Supply the two keyframe node IDs and plans; do not also send `connect_nodes`, `bind_assets`, or low-level role patches for those relationships. Existing intentional authorities feeding the first generator remain intact.

## Author three different plans

### First image plan

`keyframes.first.promptPlan` describes only what is visible at time zero as an `image-keyframe`:

- frozen subject pose and expression;
- product/character identity and count;
- composition, camera height/angle/axis, framing, and placement;
- environment geometry and depth layers;
- frozen lighting setup, direction, palette, material finish, and atmosphere;
- continuity facts that the later edit must preserve.

Do not describe camera movement, a sequence of actions, or what will happen later.

### Last image edit plan

`keyframes.last.promptPlan` describes the final frozen state and the minimum edit from the supplied first-frame image:

- name the final pose, placement, expression, object state, or revealed detail;
- repeat the protected invariants that must be copied from the first image;
- keep subject identity, geometry, environment, camera axis, lens/framing, scale, materials, palette, and light direction unless the intended transition explicitly changes one;
- change only facts required to reach the final state;
- describe a static result, not motion verbs or a miniature video prompt.

The compiled prompt explicitly instructs the image model to treat the generated first frame as the sole visual continuity authority. Text communicates the intended delta; the first image carries visual identity and scene consistency.

### Video transition plan

The video `first-last-frame-plan` describes only how the visible world moves continuously from the first image to the last:

- `continuity[]`: facts that remain invariant throughout the shot;
- `stateChanges[]`: endpoint differences that the motion must produce;
- `physicalPath`: causal and chronological movement connecting the endpoints;
- camera movement, subject choreography, secondary motion, pacing, and settling behavior;
- exclusions that prevent teleportation, identity drift, geometry warping, duplicate subjects, or an early/late endpoint match.

Never reuse the video plan as either image plan. Never reuse one image plan for both endpoints.

## Endpoint design procedure

1. Write the final video intention as a start state, an end state, and one plausible physical path.
2. Freeze the exact start state and author the first image plan.
3. Duplicate the continuity ledger, then change only the facts that must differ at the endpoint; author the last image edit plan.
4. Verify the final state can be reached within the requested duration without cuts or impossible morphs.
5. Author the video transition contract from the verified delta.
6. Submit all three plans in one `configure_video_shot` operation with `exactOpening=true` and `exactEnding=true` when both endpoints are hard authorities.

Set `exactEnding=true` only because the last image is authoritative. A stable but freely generated ending belongs in `finalState` with `exactEnding=false` and should use a different method when no endpoint image is required.

## Feasibility and continuity gate

Reject or redesign endpoint pairs that disagree unintentionally on identity, subject count, environment, camera axis, lens/framing, scale, aspect ratio, or light direction. If the intended change cannot happen continuously in one shot, insert an intermediate shot instead of asking the model to conceal an impossible morph.

Before run preparation, inspect readiness. `video-keyframe-derivation-missing` means the last frame is independent of the first. `video-keyframe-modes-invalid` means the last-image or interpolation stage uses the wrong generation mode; ordinary generation diagnostics cover incompatible authorities on the first generator. Repair the endpoint chain through `configure_video_shot`; do not silence it with raw edges.

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
