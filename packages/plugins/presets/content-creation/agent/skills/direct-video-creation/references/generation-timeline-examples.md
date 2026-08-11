# Video-generation timeline examples

These are prompt-level timing patterns for one video-model generation. Adapt shot count, duration, syntax, audio, and reference roles to inspected capabilities.

## Contents

- 5-second micro arc
- 10-second continuous product demonstration
- 15-second award ceremony
- 15-second freeze-time effect
- 15-second vertical UGC demonstration
- 15-second process tutorial
- 20-second action sequence
- 30-second emotional performance
- Repair by symptom

## 5-second micro arc

Use only when the selected profile follows short timestamped stages. Treat these as beats within one coherent shot unless multi-shot generation is explicitly supported.

```text
Duration: 5 seconds. One continuous camera move, no cuts.
[00:00-00:01] Establish — tight medium view; the runner braces against the starting block, fabric and breath moving subtly.
[00:01-00:02] Trigger — the signal flashes; her fingers release and the camera begins a low forward track.
[00:02-00:04] Action — she drives forward through two powerful strides; background parallax increases, identity and lane geometry stay stable.
[00:04-00:05] Payoff — she crosses the foreground; camera settles briefly on her determined profile, readable rather than blurred.
```

For models that reliably support cuts, the same arc can become two or three shots: establish, action, payoff. Do not automatically turn every beat into a cut.

## 10-second continuous product demonstration

```text
Reference role: input image defines exact product geometry, label, color, and opening composition.
Duration: 10 seconds. One physically continuous tabletop camera path. No cuts.

[00:00-00:03] Establish — product stands sealed on the counter; a hand enters from frame right. Slow lateral slide reveals the label without changing it.
[00:03-00:07] Demonstrate — the hand opens the cap and dispenses one measured drop; macro focus follows the drop while the bottle remains recognizable. Soft practical reflections move across the material.
[00:07-00:10] Proof and resolve — the hand exits; focus returns to the unchanged label and clean product silhouette. Camera rests for the final second on a stable hero frame.

Avoid label mutation, extra fingers, duplicate containers, liquid appearing before the cap opens, or camera teleportation.
```

## 15-second award ceremony

```text
Reference roles: image 1 is the winner identity; image 2 is the host identity; image 3 defines the venue. Never swap roles.
Duration: 15 seconds. Native dialogue and crowd ambience only if supported.

[00:00-00:03] Announcement — medium two-shot. The host reads the winner's exact name; the winner is visible in the audience and has not moved yet.
[00:03-00:06] Reaction — cut or reframe to the winner. Surprise becomes a contained smile; nearby guests turn toward the winner. Applause begins.
[00:06-00:09] Approach — wide geography shot. The winner stands and walks along the clear aisle toward the stage; screen direction remains left to right.
[00:09-00:12] Handoff — medium stage view. The host presents the award once; their hands meet the same object without duplication.
[00:12-00:15] Final — hero two-shot. Both face camera, the award is readable, the spoken name and any visible title remain exact. Movement settles into a one-second hold.
```

## 15-second freeze-time effect

```text
Duration: 15 seconds. Preserve the protagonist and environment through every phase.

[00:00-00:03] Normal motion — busy cafe activity, natural ambience, protagonist enters at walking speed.
[00:03-00:06] Trigger — a glass begins to fall; the protagonist raises one hand. At the gesture, people, liquid, and loose fabric stop in physically suspended positions; ambience drops to near silence.
[00:06-00:10] Proof — continuous slow move around the protagonist as they walk between frozen figures. No frozen subject drifts or changes pose.
[00:10-00:13] Release — protagonist lowers the hand; sound and motion return from their suspended states. The glass continues the same fall rather than resetting.
[00:13-00:15] Consequence — the protagonist catches the glass and places it upright. Camera settles on the intact glass and their restrained reaction.
```

## 15-second vertical UGC demonstration

```text
Reference roles: person image controls identity and outfit; product image controls package and label.
Format: 9:16. Duration: 15 seconds. Credible handheld phone framing with controlled motion.

[00:00-00:03] Hook — creator holds the real product beside their face and states one verified problem in a short line. Label faces camera.
[00:03-00:08] Use — creator performs one complete use action in a medium close view. Hands never obscure the evidence; practical room ambience remains natural.
[00:08-00:12] Proof — tighter detail shows the visible result or mechanism. Spoken claim is limited to supplied facts; product shape and text remain unchanged.
[00:12-00:15] Resolve — return to creator and product together. One concise CTA if supplied; finish on a steady, readable product hold.
```

If dialogue, native audio, or multiple reference roles are unsupported, separate those deliverables rather than pretending this exact structure is executable.

## 15-second process tutorial

```text
Duration: 15 seconds. The numbered storyboard board controls workspace and action order; the clean object reference controls fidelity.

[00:00-00:03] Setup — overhead wide shows all required tools in their starting positions; hands enter empty.
[00:03-00:07] Step 1 — close overhead view performs one preparation action. End with the changed material clearly visible.
[00:07-00:11] Step 2 — medium detail continues from that exact material state and completes one assembly action. Tools remain in consistent positions.
[00:11-00:15] Result — reveal the finished result, then hold long enough to inspect it. No skipped causal step is implied as visible proof.
```

When the process has more steps than the duration can show, choose only the essential transformation or create separate ordered generation prompts.

## 20-second action sequence

Use this only for a mode proven to follow timestamped multi-shot direction. Otherwise make each shot an independent generation.

```text
Global continuity: same two fighters, wardrobe damage, alley geography, wet ground, cyan sign on frame left, escape direction toward frame right.

[00:00-00:04] Establish geography — wide view identifies both fighters, obstacle positions, and the exit. Fighter A advances; Fighter B yields two steps toward frame right.
[00:04-00:08] Threat and defense — cut to medium side view on the same axis. One strike, one block; rain and coat fabric react at impact.
[00:08-00:12] Reversal — low close view. Fighter B redirects the arm and turns Fighter A toward the wall; no extra limbs or axis reversal.
[00:12-00:16] Impact — wide proof shot shows the wall contact and both full body positions. Insert a brief stillness after impact.
[00:16-00:20] Resolve — close reaction then controlled pull-out. Fighter B reaches the established exit; Fighter A remains by the wall. End on readable separation.
```

## 30-second emotional performance

Longer duration does not justify more events. Give reactions and state transitions enough time to read.

```text
Duration: 30 seconds. One room, two labeled characters, restrained camera grammar.

[00:00-00:05] Setup — locked medium two-shot. Character A places an unopened letter between them; Character B keeps their hands away. Quiet room tone.
[00:05-00:11] Pressure — slow push toward Character B as they recognize the handwriting. Their gaze moves from the letter to A; no dialogue yet.
[00:11-00:17] Choice — Character B reaches, stops, then takes the letter. Paper sound is prominent; A withdraws their hand.
[00:17-00:23] Turn — close on A during one short supplied line. Hold enough reaction space for B rather than cutting immediately.
[00:23-00:30] Resolve — return to a wider two-shot. B opens the letter but does not read it aloud; A moves toward the door. End before A exits, leaving the distance and decision visible.
```

## Repair by symptom

- Events happen together: reduce to one state change per window and add explicit end states.
- Model ignores later windows: shorten the overall generation, reduce stages, or split into independent prompts.
- Cuts feel random: name shot functions and visible/audible cut triggers; remove redundant shots.
- Continuity collapses after a cut: repeat the minimal identity, prop, geography, screen-direction, and light handoff.
- Camera teleports in a one-shot: draw one physical path and make every window continue from the previous camera position.
- Dialogue and action conflict: shorten speech, assign speakers explicitly, and reserve reaction time.
- Final image is unreadable: stop the principal action earlier and dedicate the final window to a stable hold.
