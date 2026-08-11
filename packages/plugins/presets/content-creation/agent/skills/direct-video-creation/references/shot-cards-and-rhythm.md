# Shot cards and rhythm

First separate dramatic beats, prompt time windows, and shots with `generation-timeline-and-storyboard.md`. This file refines creative rhythm inside a video generation or across an ordered set of generation prompts.

## Shot card

Fill every field for a planned shot:

- ID and time window;
- dramatic/information beat;
- function: establish, reveal, power, pressure, detail, reaction, shift, impact, aftermath, exit;
- emotion translated into visible behavior;
- framing, angle, composition, and focal point;
- camera move and why it moves;
- subject action and object state change;
- eye trace at entry;
- environment pressure;
- light/palette;
- sound/motif;
- cut/transition;
- visible end state;
- continuity and production note.

An empty field exposes missing direction. Delete a shot that changes nothing, advances nothing, and increases no pressure.

## Rhythm ladder

Build stepped rhythm rather than uniform cuts:

`long -> shorter -> shorter -> pause -> impact -> aftermath`

Examples:

- restrained drama: 4s, 4s, 3s, 2s, 1s, pause, 2s;
- product arc: 3s, 2s, 1.5s, 1s, detail beat, 2s hero/end state;
- anxiety: 2s, 1s, 1s, 0.5s, 0.5s, pause, 1s;
- impact: pause, brief event, held consequence.

Treat these as rhythm targets, then fit them to durations and temporal precision actually supported by the chosen mode. A prompt window is an attention and event budget, not an edit point. Do not demand sub-second state changes from a model that cannot reliably honor them; merge micro-beats into a larger physical action or use separate generation prompts.

## Density rules

- Emotional drama uses fewer, longer reaction/state-change shots.
- Standard narrative uses moderate beat density.
- Fast montage may use dense inserts only when every cut has a distinct function and spatial anchor.

Never use fast cuts to cover unclear action. Eye trace and screen direction must carry across cuts.

## Handoffs

The end-state card of clip N becomes the start-state contract of clip N+1: same subject instance, pose, prop ownership, environment, light direction, camera axis, motion direction, and audio relationship unless a deliberate transition changes them.
