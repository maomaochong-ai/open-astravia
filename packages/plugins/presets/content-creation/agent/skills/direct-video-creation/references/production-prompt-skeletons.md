# Video production prompt skeletons

Adapt syntax to `model-prompt-profiles.md` and values to inspected capabilities.

## Single shot

```text
{Framing and one primary camera move}. {Identity/subject} {one principal physical action} in {environment}. {Environmental pressure}; {body/object micro-action}; {sound or visual motif}. Light: {source, direction, quality, palette}. The move begins when {visible trigger} and rests on {explicit final image}. Preserve {continuity anchors}.
```

## Image-to-video

```text
Reference role: the input image defines {identity/composition/product/start state}; ignore {non-transferable elements}. Preserve {visible invariants}. {Subject action}, while {environmental motion}. Camera {one move, speed, direction, rest point}. Light changes {only if needed}. Audio intent: {ambience/action/dialogue policy}. End on {final state}.
```

## Multi-shot sequence

Use this only when inspected capabilities support multiple timestamped shots in one generation. Otherwise create one prompt/node per shot and return an ordered sequence specification.

```text
Characters/subjects: {stable labeled identity blocks}.
Master intent: {desire/goal, obstacle, geometry, emotional or information arc}.
Global continuity: {wardrobe/product, environment, palette, light direction, screen direction, motif}.
[00:00-00:03] Shot 1 — {function}; {entry state}; {framing}; {physical event}; {camera}; {audio}; end state {state}.
[00:03-00:06] Shot 2 — {function}; begin from {prior end state}; ...
Camera/edit rhythm: {dominant grammar; cut triggers; pause; impact}.
Audio: {ambience, body/action sounds, dialogue, music/silence policy}.
Final image: {mandatory composition}.
```

## Dialogue scene

```text
[Character A: {identity, wardrobe, distinguishing details}]
[Character B: {identity, wardrobe, distinguishing details}]
{Space and power geometry}. {Light and environmental pressure}.
{Visible action anchor}. [Character A, {voice/delivery}]: "{short speakable line}"
{Temporal connector and reaction action}. [Character B, {voice/delivery}]: "{short speakable line}"
Camera: {shot/reverse-shot or controlled move}. Audio: {ambience/action sounds}; {music policy}. End on {reaction/final state}.
```

## Reference/video edit

```text
Edit Goal: {one change within time range}.
Source Master: {video reference} defines characters, action, timing, camera, cuts, geometry, light, and audio.
Target References: {asset -> role -> attributes to inherit/ignore}.
Edit Scope: modify only {subject/region/audio/time}.
Preserve: {complete invariants and every unedited element}.
End state: {required result}; no duplication, pop-in, clipping, or unrelated redesign.
```

## Continuation

```text
Continue directly from {source final frame/state}. Preserve the same subject instance, pose, prop positions, environment, camera axis, lighting, motion direction, visual system, and voice relationship. Then {one new event} caused by {trigger}. End on {new visible final state}. Do not duplicate subjects or introduce elements before their causal entrance.
```
