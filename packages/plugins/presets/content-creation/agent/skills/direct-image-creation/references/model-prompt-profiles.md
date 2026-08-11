# Image model prompt profiles

Inspect capabilities first and select a model/mode with `model-routing.md`. A profile controls prompt syntax; it does not authorize unsupported ratios, resolutions, quality settings, reference counts, or edit slots.

## Sectioned constraint profile

Use for current OpenAI image-family models and other models whose selected adapter is known to follow sectioned instructions.

```text
Scene: <place, time, background, environment>
Subject: <primary subject, identity, pose/action, placement>
Important Details: <composition, light, materials, palette, typography>
Use Case: <actual destination and audience>
Constraints: <preserve rules, exact copy, geometry, exclusions>
```

Rules:

- Put hard functional requirements in `Constraints` rather than burying them in mood language.
- Replace praise words with visible facts: surface, wear, shadow, depth, scale, crop, and hierarchy.
- Put exact rendered copy in quotes and state `no extra or duplicate text` when appropriate.
- For edits use `Change / Preserve / Constraints`; repeat the preserve list on every iteration.
- Set `quality` only when the inspected capability or selected node exposes it. Treat it as a fidelity/cost lever, not a synonym for a better prompt.

## Natural-language reasoning profile

Use for current Nano Banana/Gemini image-family models and other adapters known to respond better to connected prose.

Write one or two coherent paragraphs in this order:

`operation -> subject/action -> context -> composition -> light/material/style -> format/preservation`

Rules:

- Describe optical effects rather than relying on numeric lens/aperture settings.
- For five or more independently controlled elements, use clearly labeled clauses or structured data only if the selected adapter accepts it.
- Assign every reference an individual role: identity, product, composition, style, palette, or background. State what to ignore.
- For edits state what changes and what stays fixed, then iterate one change at a time.

## Generic capability-first profile

Use when the family has no verified syntax profile. Write concise natural language with a labeled constraints tail. Do not invent provider flags. Start with automatic model selection and learn from the first candidate before adding model-specific complexity.

## Parameter separation

Keep prompt and executable parameters distinct:

- prompt: visual and preservation directions;
- node fields: aspect ratio, resolution, quality, provider/model/mode;
- asset bindings: reference roles and actual input slots.

Never paste CLI flags or provider UI settings into the prompt unless the selected adapter explicitly defines them as prompt syntax.
