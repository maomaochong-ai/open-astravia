# Continuity and references

## Create a continuity ledger

Before a multi-shot sequence, record the invariants:

- subject identity, silhouette, age cues, hair, wardrobe, and accessories;
- product proportions, labels, materials, and color;
- environment layout, time of day, weather, and light direction;
- palette, texture, lens family, depth of field, and motion energy;
- left/right screen direction and important prop positions.

Copy the smallest sufficient set into each shot prompt. Do not rely on chat memory alone.

## Assign reference roles deliberately

Use references for a named reason: identity, composition, style, start state, end state, or motion. Inspect the mode's input slots before assigning assets. More references are not automatically better; conflicting references weaken control.

Prefer an approved clean still as the starting frame when exact identity, product geometry, or composition matters. For first/last-frame modes, ensure both frames are compatible in subject count, camera axis, and environment, then describe the transition rather than two independent scenes.

## Protect the final image

Define the last readable state of every shot. A controlled final frame improves cuts, loops, and continuation. For adjoining shots, either match the prior end state or make the discontinuity intentional and visible.

## Change one continuity axis at a time

During iteration, isolate changes to action, camera, environment, style, or reference. If several axes change together, the result cannot teach you which decision helped.
