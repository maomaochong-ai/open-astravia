# Image prompt framework

## Build prompts in decision order

Put the highest-value visual decisions first:

1. Artifact and purpose: what is being made and where it will be used.
2. Subject: identity, form, materials, clothing, pose, expression, and interaction.
3. Composition: shot size, viewpoint, subject placement, foreground/background, negative space, and crop.
4. Environment: location, era, props, weather, and depth layers.
5. Light and color: source direction, hardness, contrast, palette, and time of day.
6. Medium and finish: photographic, illustration, 3D, collage, print, texture, and post-process language.
7. Constraints: text content, brand geometry, must-preserve details, and exclusions.

Use concrete observable language. Replace vague terms such as “epic” with decisions about scale, angle, contrast, atmosphere, and action.

## Match detail to importance

Describe important objects precisely and background elements lightly. Excess detail creates competing anchors. When text must appear in the image, provide the exact copy, its hierarchy, approximate placement, and legibility requirement. Do not assume perfect typography; prefer leaving clean layout space when downstream typesetting is available.

## Compose for the destination

- Feed/post: immediate focal point and robust crop.
- Story/reel cover: vertical hierarchy and protected UI zones.
- Banner: deliberate negative space for copy.
- Product detail: readable silhouette, material truth, and brand-safe geometry.
- Storyboard/keyframe: action, staging, screen direction, and continuity over polish.

## Create useful variants

Keep the brief and subject anchors fixed. Change one axis per candidate and encode it in the node purpose. A candidate set should test meaningful alternatives, not near-duplicates.
