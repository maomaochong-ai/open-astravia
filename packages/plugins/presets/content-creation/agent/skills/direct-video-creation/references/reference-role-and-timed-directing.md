# Reference roles and timed directing

Use this for instructional video models, multi-reference generation, native audio, or precise 10-15 second sequences. All limits and modes come from inspected capabilities.

## Build a reference manifest

Assign every supplied asset exactly one primary role before writing the prompt:

| Role | What the asset controls |
| --- | --- |
| Identity | face/body/character instance |
| Product | geometry, label, material, color |
| Environment | layout, set dressing, time/weather |
| Style | palette, rendering treatment, texture |
| Composition/start | opening framing and object positions |
| End | required final framing and state |
| Motion | action or camera choreography from a video |
| Audio | voice, music, rhythm, ambience, or effects |

Record the slot/index produced by the selected mode and mention each reference by that exact role. Never say only "follow all references." If two assets disagree, choose an authority or remove one.

## Director brief order

Write in this order unless the selected model profile requires another grammar:

```text
Reference roles: <slot -> role and preservation strength>
Scene: <environment, time, motivated light>
Subject/product: <visible invariants>
Action: <one fluid state change per beat>
Camera: <shot size, lens family, physical path, speed>
Audio: <dialogue/voice, ambience, effects, music, silence>
Timeline: <time ranges and one beat each>
Style/finish: <grade, texture, motion energy>
Final state: <readable last frame and handoff>
Avoid: <task-specific failure states>
```

Lead with composition and authority. Put texture and micro-motion after the action/camera contract.

## Timed beats

- 4-7 seconds: one principal action and one camera idea.
- 8-10 seconds: one action with setup and resolve, or two simple beats.
- 11-15 seconds: at most 3-4 clear beats.

Each segment must have a visible starting state, one event, and an ending state. Do not put two location changes, a transformation, dialogue, and a product reveal into the same short segment.

## Audio direction

When native audio is supported, name layers independently:

- dialogue and delivery, including exact speaker assignment;
- ambience tied to place;
- action effects tied to timestamps/events;
- music genre, energy curve, and resolve;
- deliberate silence where it carries the effect.

When native audio is not supported, create or reserve a separate audio/timeline plan. Never bury required dialogue in a visual-only prompt and assume it will exist.

## First/last frame and interpolation

Use distinct start/end roles only when the inspected mode exposes them. Ensure both frames agree on subject count, identity, environment, camera axis, scale, and light. Describe the physical transition between them. If they are incompatible, insert an intermediate shot rather than demanding an impossible morph.

## Multi-reference and composite boards

Use a composite board to consolidate character, environment, action panels, and style when input slots are scarce. Keep a clean original identity/product asset alongside the board when the mode allows it; the clean asset controls fidelity while the board controls choreography and world.

## Edit, extension, and trained-character patterns

- Edit: name one changed subject/region/time span and a comprehensive preserve list.
- Extension: begin from the exact source final state and define a new final state.
- Prepend: end on the exact source opening state and prohibit later props/characters from appearing early.
- Persistent character references: use only when the capability exposes them; otherwise maintain a reference/continuity ledger with approved stills.

## Failure diagnosis

- Weak identity: simplify references, strengthen authority role, repair the anchor still.
- Ignored choreography: reduce beats, use a storyboard/action board, or split shots.
- Random audio: add explicit layers or move audio to separate production.
- Aimless camera: give it a subject-relative path and destination.
- Broken final frame: state the final composition and stop motion before the cut.

