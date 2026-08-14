# Animate-still method

Use one still as the authoritative opening composition. The video prompt describes the delta from that still, not a second description of the image.

## Build the source-image contract

- `authority`: state whether the image controls identity, product geometry, composition, materials, lighting, or all of them.
- `inherit[]`: list facts that remain unchanged throughout the shot.
- `animate[]`: list only the subject, environmental, light, or camera changes that should occur.
- `introduce[]`: list genuinely new visible elements; use an empty list when nothing new should appear.

Then describe one chronological motion path from the visible opening state to the final state. Treat the input as the first frame unless inspected capability says otherwise.

## Failure prevention

- Do not redundantly redescribe the whole still; doing so invites reconstruction and identity drift.
- Do not ask the model to reach an independently exact final composition. Use first/last-frame instead.
- Do not attach several identity or scene authorities under this method. Use omni-reference.
- Distinguish camera motion from subject motion and state their speeds and stopping points.

## Minimal shape

```json
{
  "kind": "animate-still-plan",
  "sourceImageContract": {
    "authority": "the image controls product identity, geometry, materials, and opening composition",
    "inherit": ["label design", "surface color", "studio layout"],
    "animate": ["one highlight crosses the surface", "camera pushes in slowly"],
    "introduce": []
  }
}
```
