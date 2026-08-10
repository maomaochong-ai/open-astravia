# Visual decomposition

Use when a reference image must be analyzed, recreated, or used for style transfer. Separate observation from synthesis so invented details do not masquerade as evidence.

## Observation pass

Extract only visible facts:

### Subject and staging

- identity-independent appearance, clothing, material, pose, expression, gaze;
- shot size and subject placement;
- power, isolation, barriers, overlaps, and visual weight;
- action vector and implied motion.

### Space and composition

- foreground, action plane, background, and their jobs;
- symmetry/asymmetry, frame divisions, negative space, leading lines;
- depth, scale, perspective, occlusion, reflection, and crop.

### Light and color

- visible source, direction, hardness, fill, rim, shadow density;
- high/low key, contrast, temperature relationship, local reflections;
- dominant, supporting, and accent colors.

### Optics and texture

- viewpoint, lens feel, depth of field, compression/distortion;
- motion blur, diffusion, bloom, grain, halation, surface wear, and medium.

Do not infer a named artist, camera, or film stock when the pixels only support a visual property.

## Synthesis pass

Choose what the new work should inherit:

- composition only;
- palette/light only;
- material/medium only;
- identity/product only;
- full visual system.

Assign the reference that role and state what must not transfer. Build the final prompt in this order:

`framing/optics -> new subject/staging -> depth/environment -> light/contrast -> palette -> texture/finish -> preservation constraints`

## Output

Return a compact analysis log, the selected transferable properties, the reference role/exclusions, and a model-profile-compatible prompt. Do not reproduce trademarks, people, or copyrighted characters unless the user's request and assets authorize it.
