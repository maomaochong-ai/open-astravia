# Image production prompt skeletons

Fill only fields that carry a real decision. Adapt syntax using `model-prompt-profiles.md`.

## Sectioned generation

```text
Scene: {location, time, background, atmosphere}
Subject: {identity/object, pose/action, placement, scale}
Important Details: {composition, focal order, light source/direction, materials, palette, texture}
Use Case: {artifact, audience, publishing surface}
Constraints: preserve {invariants}; render only "{exact copy}"; {safe areas}; {exclusions}
```

## Natural-prose generation

```text
Create {artifact} for {use case}. {Subject with concrete appearance/material} {action/pose} in {environment}. Compose as {framing/layout} with {focal hierarchy and negative space}. Light with {source, direction, quality}; render {materials/textures} in {palette/medium}. Preserve {invariants}. Format: {ratio}.
```

## Surgical edit

```text
Change: {one object, region, attribute, or text change}.
Preserve: {identity, pose, geometry, camera, light, background, layout, exact text}.
Constraints: {spatial boundary, no new objects, no drift, target ratio}.
```

## Product hero

```text
Scene: {surface/environment} with {background and atmosphere}
Subject: {product authority description}, {angle and placement}
Important Details: preserve {geometry/label/logo}; {material response}; {key/fill/contact shadow}; {copy space}; {supporting props}
Use Case: {channel and campaign role}
Constraints: exact product proportions and label; physically plausible reflection/contact; no competing props or unrelated marks
```

## Exact-text poster

```text
Purpose: {poster/ad/information artifact} for {audience}
Visual: {hero element, composition, palette, medium}
Typography: headline "{exact headline}" at {position}, {weight/style/color}; subhead "{exact subhead}" at {position}
Hierarchy: {first -> second -> third read}
Constraints: no extra, duplicated, misspelled, placeholder, or watermark text; protect {safe zones}; readable at {delivery size}
```

## Multi-panel sheet

```text
Create one {rows}x{columns} {sheet type}, read {reading order}, with {border/gap behavior}.
Shared anchors: {identity/product, wardrobe, environment, palette, light, medium}.
Panel 1 ({position/function}): {distinct visible state}.
...
Panel N ({position/function}): {distinct visible state}.
Constraints: exact panel count; no merged/duplicate cells; preserve shared anchors; {caption rules}.
```

## Reference-based transformation

```text
Reference 1 role: {identity/product/composition/style/base image}; inherit only {attributes}; ignore {background/text/people/style}.
Reference 2 role: {role}; inherit only {attributes}.
Create {new subject/use case} while preserving {authority details}. Apply {observed composition/light/palette/material properties}. Constraints: {non-transferable elements and exact invariants}.
```
