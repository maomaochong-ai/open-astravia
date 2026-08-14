# Text-to-video method

Use text to video to explore or construct a shot when no supplied media must be reproduced exactly.

## Build the plan

1. Define the entire visible world in `worldDefinition`: subject, environment, and visual treatment.
2. Establish an observable initial state before describing motion.
3. Give the subject one principal action with a physical cause and consequence.
4. Give the camera one motivated path that can finish within the duration.
5. Define a readable final state instead of ending on continued motion.

Use `referenceRole` to state that the written world definition is authoritative and that no external media is being inherited. Put identity or geometry facts that must remain stable in `protectedInvariants`.

## Failure prevention

- Do not write “cinematic” as a substitute for subject, environment, lens behavior, light, or movement.
- Do not imply a source image, first frame, or reference token that does not exist.
- Split a short shot that contains several locations, transformations, or unrelated camera moves.
- If exact identity or composition appears during planning, switch to animate-still or omni-reference.

## Minimal shape

```json
{
  "kind": "text-to-video-plan",
  "worldDefinition": {
    "subject": "visible subject and defining physical traits",
    "environment": "spatial layout, time, weather, and motivated light sources",
    "visualStyle": "medium, texture, color treatment, and lens character"
  }
}
```
