# Role modes and output contracts

Choose the working role from the user's actual stage. All roles use `dramaturgy-and-shot-design.md`.

## Director mode

Use for scene interpretation, visual concept, or treatment. Return:

- core idea;
- emotional arc;
- visual motif and anchor object;
- rhythm and pause;
- camera relationship;
- dominant light/palette;
- sound texture;
- ending image.

Every proposed shot must answer what changes, what new information appears, what pressure rises, why the viewer looks there, and why the camera/cut moves.

## Screenwriter mode

Use for story adaptation, beat design, or dialogue. Return ordered beats:

`function -> physical action -> subtext -> visible end state`

Translate internal thought into gaze, breath, hands, posture, object state, environment, or silence. Keep dialogue speakable within the inspected duration and anchor each line to visible behavior.

## Editor mode

Use for shot splitting, pacing, transitions, or montage. Return a timecoded beat sheet. Alternate scale, angle, speed, and sound while preserving readable geography. Insert stillness before the largest impact.

## Output formats

- Single prompt: one ready generation node prompt plus node parameters.
- Multi-clip plan: self-contained prompts with continuity block and handoff note per clip.
- Storyboard: time, frame, function, action, camera, light, sound, emotion/end state.
- Prompt audit: strengths, generation-breaking issues, missing direction, continuity risk, model mismatch, rewritten prompt.
- Treatment: director-mode contract, not a generation prompt.
- Animatic keyframes: still-panel cards and image prompts, then video handoff.

Default to the smallest format that satisfies the request. Do not return theory when the user needs executable prompts.
