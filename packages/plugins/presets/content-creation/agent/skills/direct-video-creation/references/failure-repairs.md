# Video failure repairs

Diagnose from the rendered frames and motion, not from the prompt alone. Preserve what already works and change the smallest causal variable.

| Symptom | Likely cause | First repair |
| --- | --- | --- |
| Static result | action lacks physical verbs or environmental response | add one observable subject action and one environmental motion |
| Chaotic motion | too many beats or camera moves | keep one principal action and one primary camera move |
| Identity drift | weak/dirty reference or large pose change | use a cleaner approved still and reduce transformation distance |
| Product deformation | orbit, occlusion, or ambiguous geometry | simplify camera path, expose silhouette, strengthen reference role |
| Start-frame jump | prompt contradicts the supplied image | describe motion from the visible starting state rather than restaging it |
| End-frame miss | no explicit final state | state the ending pose, composition, and camera rest point |
| Jitter or speed jumps | conflicting motion direction or vague timing | specify direction, pace, acceleration, and stabilized camera behavior |
| Object popping | crowded interaction or hidden intermediate states | reduce interacting objects and describe the transition chronologically |
| Unwanted speech/audio | ambiguous audio intent | specify ambience/effects only, or disable audio when capability permits |
| Weak narrative | camera moves but nothing changes | add trigger -> response -> consequence |
| Multi-shot collapses into one take | boundaries or shot functions are too similar | add explicit shot windows/cuts and change framing/function at every boundary |
| Dialogue overlaps or lip-sync drifts | speaker/action/timing is ambiguous | use stable speaker labels, visible action anchors, delivery, and temporal connectors; shorten lines |
| Wrong voice | generic speaker identity | bind a specific speaker and voice quality, or use a supported voice reference role |
| Extra subtitles or music | output policy is ambiguous or unsupported | state the required audio/text policy; disable/strip in post when the adapter cannot reliably control it |
| Reference bleed | an asset has no role or exclusion | bind each asset individually and state what to inherit and ignore |
| Long prompt cherry-picking | too many priorities or contradictions | declare protected subject, mandatory beats/final frame, then compress secondary style detail |

If the reference itself contains bad anatomy, text, crop, or lighting ambiguity, repair or replace the still before another video attempt. If the mode cannot satisfy a hard requirement, change the mode or disclose the limitation instead of endlessly rewriting the prompt.

## Compression order

When a selected model needs a shorter prompt, preserve in this order: identity/continuity, story action and final state, shot timing, light, camera, edit grammar, audio, then style. Remove theory, repeated adjectives, and named references before removing causal direction.
