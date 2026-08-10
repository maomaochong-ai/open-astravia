# Video-generation timeline and storyboard

Use this reference when a video prompt needs explicit temporal direction. A **generation timeline** is a sequence of time windows inside one request to a video model. It tells the model what should become visible over the requested duration.

Keep the generation timeline as prompt text inside the video generator node.

## Contents

- Choose the temporal mode first
- Build three layers
- Timestamp rules
- Continuous-shot generation
- Multi-shot generation
- Storyboard mapping
- Prompt assembly order
- Quality gate

## Choose the temporal mode first

Inspect the selected mode before choosing a structure:

1. **Single coherent shot**: one camera path and one causal event, divided into stages without cuts.
2. **Timestamped staged generation**: several consecutive event windows in one scene, with either a continuous camera or simple transitions.
3. **Timestamped multi-shot generation**: explicit shot changes or `Cut to` instructions inside one generation. Use only when the inspected capability or model profile supports this grammar.
4. **Independent generations**: one prompt/node per shot when multi-shot following is unsupported or continuity risk is high. Return a sequence manifest.

Do not infer temporal precision, multi-shot support, native audio, first/last-frame control, or maximum duration from a model name alone.

## Build three layers

### 1. Dramatic or information beats

State what changes for the viewer:

- hook or starting question;
- setup or readable initial state;
- trigger;
- escalation, demonstration, or reversal;
- payoff, proof, reaction, or unresolved hook.

### 2. Shot or stage functions

Give every stage one job: establish, reveal, demonstrate, pressure, reaction, transition, impact, proof, or resolve. Delete a stage that changes no state and communicates no new evidence.

### 3. Generation windows

Allocate the supported duration into consecutive, non-overlapping windows. Each window should contain:

```text
[00:00-00:03] <beat name and shot function>
Entry state: <what is already visible and stable>
Primary event: <one physical action or state change>
Camera: <one framing/path and where it settles>
Physical evidence: <environment response, body/object micro-action>
Audio: <dialogue, ambience, effects, music, or silence if supported>
End state: <the visible condition that must exist at the boundary>
Carry forward: <identity, prop, position, direction, light, motion>
Avoid: <window-specific collapse states>
```

Compress this card into fluent model-specific prose when needed, but keep its causal information.

## Timestamp rules

- Cover the full requested duration from zero to the end.
- Keep ranges consecutive and non-overlapping. Do not leave accidental gaps.
- Treat a range as an event and attention budget, not an edit point.
- Give each range one principal state change, normally with one primary subject action and one primary camera move.
- Describe a visible entry and end state. The next window inherits the prior end state unless a cut explicitly changes it.
- Use physical triggers: `when the door opens`, `after the glass lands`, or `as she looks up`. Do not schedule abstract feelings by clock alone.
- Use exact seconds for critical handoffs, dialogue turns, reveals, or effects. Use relative triggers where frame-accurate timing is unnecessary.
- Do not demand sub-second precision unless the inspected profile demonstrates it. Merge micro-beats or use separate generations.
- Put dialogue, sound effects, music changes, and deliberate silence in the same window as the visible event they support.
- Repeat only global invariants that the profile benefits from; do not fill every window with identical style adjectives.

## Continuous-shot generation

A continuous shot may still have a timeline. Its windows describe stages along one drawable camera path, not cuts.

```text
Global camera path: begin behind the subject, arc left around the table, finish on the product label. No cuts or teleportation.

[00:00-00:03] Establish. The subject enters frame; camera follows at walking speed.
[00:03-00:07] Demonstrate. She places the product on the table; camera arcs left while preserving screen direction.
[00:07-00:10] Resolve. Her hand leaves the label unobstructed; camera settles into a stable hero close-up.
```

Each stage must be reachable from the previous physical camera position. Reject paths that require an orbit, crane, whip pan, and macro push at the same time.

## Multi-shot generation

Use explicit cuts only when supported. Keep shot count proportional to duration and temporal following quality.

```text
[00:00-00:02] Shot 1 — Hook, tight detail. <event and end state>.
Cut on <visible or audible trigger>.
[00:02-00:05] Shot 2 — Demonstration, medium view. Begin from <handoff>. <event and end state>.
Cut to reaction after <trigger>.
[00:05-00:08] Shot 3 — Payoff, close view. <event>. Hold final image for readability.
```

Every cut must earn a new function, scale, angle, or state. Preserve subject identity, product geometry, wardrobe, environment, light direction, screen direction, and motif unless a deliberate change is named.

## Storyboard mapping

A storyboard is the visual contract; the generation timeline is its temporal translation.

For each panel or shot card, record:

| Field | Purpose in the generation prompt |
| --- | --- |
| Panel/shot ID | Stable link between plan, reference board, prompt, and review evidence |
| Time window | Event budget inside the requested generation |
| Function | Why this stage exists |
| Start image | Composition and state at entry |
| Peak action | One readable physical change |
| End image | Boundary state or final hold |
| Camera | Framing, path, speed, and rest point |
| Continuity | Identity, props, geography, direction, light, and motion to preserve |
| Audio cue | Sound attached to the event, if supported |

For a composite storyboard reference:

- number panels and keep reading order unambiguous;
- use clean identity/product references separately when slots allow;
- state whether the board controls choreography, composition, environment, or style;
- reduce a dense board to the few stages the selected mode can follow;
- never assume a 16-panel board means one generation can perform 16 actions.

For a start/end-frame mode, treat the two frames as boundary authorities. The prompt timeline must describe a physically plausible transition between them; it cannot repair incompatible identity, subject count, geometry, light, or camera axis.

## Prompt assembly order

Use the selected model profile's grammar, with this information order as a reliable default:

```text
Reference roles and preservation strength
Generation duration and master intent
Global subject, product, environment, continuity, and style invariants
Global camera/edit grammar and audio policy
Timestamped generation timeline or continuous-shot stages
Mandatory final image and hold
Task-specific avoid list
```

## Quality gate

Before execution, verify:

- the ranges exactly cover the requested duration;
- every window changes one visible state;
- action density fits the inspected mode;
- camera paths are physically compatible;
- cut triggers and handoffs are explicit where needed;
- the storyboard panel order matches the prompt window order;
- identity, product geometry, prop ownership, geography, screen direction, and light remain controlled;
- audio instructions are present only when supported, otherwise separated honestly;
- the final window ends on a readable image rather than motion blur or an unfinished action;
