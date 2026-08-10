# Video prompting

## Text to video

Describe both what is visible and how it changes over time. Start with the highest-value details and add constraints only when they remove real ambiguity.

Recommended structure:

`[shot/framing] of [subject] [action] in [environment]. [camera motion]. [environmental motion]. [lighting/style]. [timing or ending state].`

Cover as needed:

- subject appearance and action;
- environment and moving background elements;
- shot size, angle, composition, and lens feel;
- camera direction, speed, stability, and focus changes;
- lighting, texture, medium, and color treatment;
- chronological beats when timing matters.

## Image to video

The image already establishes composition, subject, lighting, and style. Focus the prompt on:

- subject action;
- environmental motion;
- camera motion;
- direction, speed, acceleration, and timing;
- intended final state or transformation.

Avoid redundantly redescribing the entire image. Add visual description only for a new element, a transformation, or an interaction not already visible.

## Direction language

Use concrete positive direction. Prefer “locked camera” over a negative instruction such as “no camera movement.” Prefer observable physical motion over abstract mood alone.

Useful camera families include locked, handheld, pan, tilt, dolly, truck, pedestal, orbit, crane, tracking, push-in, pull-out, zoom, rack focus, macro, close-up, medium, wide, low angle, high angle, and overhead. Combine only motions that can plausibly fit the shot duration.

## Temporal clarity

For multiple beats, write them in order: initial state → motion → ending state. Keep the number of beats proportional to duration. A short clip usually supports one principal subject action and one principal camera idea.

## References and frames

- Use the cleanest available reference; image artifacts often become more visible in motion.
- Treat a start image as the first frame unless the inspected capability states otherwise.
- When a last-frame role exists, describe the transition between the two states rather than independently describing each frame.
- Do not imply a named input role that the selected model mode does not expose.
