# Video model prompt profiles

Select from `content_creation_inspect(view="capabilities")`. Model names below identify prompt grammar already present in Vetta's catalog; the inspected descriptor remains authoritative for modes, inputs, durations, ratios, and resolutions. Never infer audio, dialogue, first/last-frame, editing, or extension support from a family name alone.

## Kling 3 family profile

Use labeled subjects at the start, then a five-layer structure:

`Scene -> Characters -> Action/Shots -> Camera/Light -> Audio`

For supported multi-shot work, give every shot timing, framing, subject, physical action, and distinct angle. Anchor dialogue to a visible action, give every speaker a stable label and voice quality, and separate consecutive lines with temporal language. For image-to-video, preserve the input state and write motion-focused instructions.

## Kling 2.x profile

Keep the prompt compact:

`detailed subject + one movement + 3-5 scene elements + one camera move + light + atmosphere`

Do not overload element count. Use reference/element features only when exposed by the selected mode. If a dedicated negative field is not represented by Vetta's tool contract, do not invent one inside node data.

## Seedance profile

Use grammatical prose and explicit shot/cut markers when multi-shot behavior is known to be supported:

`identity/reference role -> duration/intent -> concrete story -> style -> camera -> edit rhythm -> audio -> timestamped generation stages/shots -> light -> composition/final frame`

For a simple single shot, compress to subject, motion, camera, environment, light, and style. Do not paste CLI flags into the prompt; Vetta stores executable duration/resolution separately. Use reference tags only if the active adapter exposes matching semantics.

## Veo profile

Use prose for simple clips:

`subject/action -> environment -> camera -> light -> style -> explicit audio/dialogue -> duration`

Use structured labeled sections when continuity or multiple beats would otherwise bleed together. Dialogue must have a named speaker, delivery, visible action anchor, and enough time to be spoken naturally. Do not assume JSON is accepted unless the selected adapter documents it.

## Generic profile

For Sora, Wan, Hailuo, Kling O1, custom providers, or unknown models, use the universal prompt order and one coherent shot per node. Start conservative. Add family-specific syntax only after capability/adapter evidence or a successful proof.

## Mode-specific shortening

- Text-to-video: describe visible world and change.
- Image-to-video: preserve visible identity/composition; describe motion, camera, light change, audio intent, and end state.
- Reference/video-to-video: name source master, target reference roles, edit scope, preserve list, and time range.

Parameters always live in node fields. Prompt profiles change prose structure, not permissions or model capabilities.
