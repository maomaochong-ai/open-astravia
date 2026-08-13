# Omni-reference method

Use omni reference when several assets control different facts in the same generated shot.

## Build the authority manifest

For every `sources[]` entry provide:

- a unique `alias`;
- one primary `semanticRole`;
- an `instruction` that states what to preserve or borrow and what not to inherit.

Use clean identity or product references for fidelity. Use an `environment` source when scene layout and lighting must remain authoritative. Add style, motion, or audio references only when the inspected mode supports their media kinds.

## Build the interaction plan

- `referenceInteraction.relationships[]` explains spatial, narrative, and control relationships between aliases.
- `referenceInteraction.chronology[]` predicts the model's scene understanding as an ordered sequence of visible events.

Mention references by semantic meaning in the plan. The plugin assigns stable provider tokens such as `<Picture 1>` after execution ordering; never guess those numbers.

## Failure prevention

- Do not say only “follow all references.” Assign authority and resolve conflicts.
- Do not use two references as equal authorities for the same fact without choosing precedence.
- Do not omit an environment image when exact scene layout is required.
- Keep chronology proportional to duration and describe expressions, body mechanics, interactions, and encounter timing explicitly.

```json
{
  "kind": "omni-reference-plan",
  "referenceInteraction": {
    "relationships": ["dancerA keeps identity from portraitA and performs inside ballroom", "dancerB keeps identity from portraitB"],
    "chronology": ["dancerA begins a waltz on the left", "dancerA crosses toward center", "dancerA meets dancerB exactly as the camera settles"]
  }
}
```
