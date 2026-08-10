# Video editing and continuation

Use only when the inspected mode exposes video input. Vetta currently represents video/reference-to-video generation, not every provider's proprietary partial re-render or native extension endpoint. Express unsupported continuation as a new clip with an explicit boundary state.

## Edit contract

```text
Edit Goal: <single change and time range>
Source Master: <video reference and what it defines>
Target References: <each asset and its role>
Edit Scope: <subject/region/audio/time range only>
Preserve: <identity, action, timing, camera, cuts, geometry, light, audio, duration>
Constraints: <known bleed/drift failures>
```

One edit target per pass. For replacement, state that the new subject inherits the original subject's timing, path, occlusion, interaction, and exit. Close with a catch-all preservation clause for every unedited person, prop, scene element, camera move, cut, and event.

For localization, preserve picture, performance pacing, scene, product, and audiovisual rhythm; change only speaker/voice/language and necessary lip movement if supported. For audio-only work, name dialogue, ambience, effects, and music separately.

## Continuation contract

For a forward continuation:

- first frame directly continues the source final state;
- preserve subject instance, pose, prop position, background, camera axis, light, motion direction, style, and voice relationship;
- define the new event and a new visible final state;
- prohibit duplication, splitting, pop-in objects, or rigid boundary cuts.

For a preceding clip, make the source first frame the explicit end state and state which later characters/props must not appear early.

## Repair versus regeneration

Prefer a scoped edit when only one region, subject, time span, or audio layer failed and the selected mode supports it. Prefer a continuation node when the source is sound and only the story must extend. Regenerate the whole clip only when the central composition, performance, or reference authority is wrong.
