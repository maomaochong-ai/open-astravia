# Text and information design

## Start from verified content

Finalize wording, facts, numbers, sequence, and language before generation. Generated infographics can look plausible while being factually wrong; visual generation is not fact validation.

For exact text specify:

- quoted copy with exact spelling and capitalization;
- hierarchy: headline, subhead, label, annotation;
- placement and alignment;
- type category, weight, color, and relative size;
- reading order and target language;
- `no extra words, duplicate text, placeholder text, or watermark` when supported.

Keep dense copy outside the image when downstream typesetting is available. If text must be baked in, shorten it and validate the output at delivery size.

## Choose an information layout

- Timeline: chronological change.
- Step flow or roadmap: ordered process.
- Split or matrix: comparison.
- Pyramid, funnel, tree: hierarchy.
- Hub/spoke or concentric rings: relationships.
- Grid or bento: modular categories.
- Map, cutaway, exploded view: spatial explanation.
- Before/after: state transformation.

Define the data-to-shape mapping. Decorative charts without valid axes, labels, scale, or sequence fail even when visually polished.

## Prompt contract

```text
Purpose/Audience: <why this exists>
Title: "<exact title>"
Content: <verified facts or ordered steps>
Layout: <named structure and reading order>
Visual System: <palette, illustration/diagram language, hierarchy>
Text Rules: <exact copy, language, placement, minimum legibility>
Constraints: <no invented facts, extra labels, overlaps, or decorative noise>
```

For localization, edit the approved asset rather than regenerate it. Change only language-dependent text and necessary line wrapping; preserve brand, images, colors, placement, and visual hierarchy. Review spelling and layout after rendering.

## Quality gate

Verify every label and number, reading order, contrast, visual-to-data mapping, text overflow, safe areas, and legibility at final display size. A visually attractive but incorrect diagram is rejected.
