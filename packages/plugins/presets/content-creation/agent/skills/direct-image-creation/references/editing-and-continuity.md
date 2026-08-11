# Editing and continuity

## Use an edit contract

Write image-edit instructions in three sections:

- Change: the exact region, object, attribute, or composition to modify.
- Preserve: identity, pose, geometry, lighting, texture, text, or background that must remain stable.
- Constraints: crop, output ratio, realism, prohibited additions, and edge behavior.

Avoid restating the whole scene as a new-generation prompt. That invites unwanted reconstruction.

## Assign every reference a role

References may control identity, product geometry, style, composition, palette, or local edit content. Name the role and priority. Do not combine references whose identity, camera, or lighting instructions conflict unless the intended blend is explicit.

Use the cleanest source available. Cropping, compression, malformed details, and baked-in text can propagate into the result.

## Preserve identity and products

Create a compact continuity ledger:

- identity: face shape, hair, age cues, skin details, silhouette;
- wardrobe: garment type, fabric, color, fit, accessories;
- product: proportions, logo placement, material, controls, seams, label text;
- scene: camera angle, light direction, background layout, palette.

For a series, reuse approved outputs as references and repeat only the invariants needed for that asset. Change pose or camera gradually when exact identity matters.

## Control local edits

State spatial boundaries using stable visual landmarks. Check seams, reflections, shadows, perspective, and texture around the edited area. If a local edit repeatedly changes the whole image, simplify the request or split it into smaller edits.
