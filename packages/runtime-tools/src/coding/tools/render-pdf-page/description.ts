export const RENDER_PDF_PAGE_TOOL_DESCRIPTION = `Render a single PDF page to a PNG image, then return the PNG file path. Use this when you need to LOOK at a PDF page with a vision-capable model, not when you need its text.

After this tool returns, follow up with \`read(<png_path>)\` so the image is loaded as an attachment for visual analysis.

When to use (visual judgments OCR cannot make)
  - Detect official seals / stamps / company chops (盖章 / 印章 / 公章 / 骑缝章)
  - Detect signatures / initials / handwritten marks
  - Inspect layout, page structure, header/footer, watermarks
  - Inspect logos, figures, charts, photographs, color
  - Read handwriting, stylized fonts, or content the text layer / OCR can't represent

When NOT to use
  - You only need textual content of the page — use \`extract_text_from_pdf\` (faster, structured).
  - You want to manipulate the PDF itself (merge / split / rotate / watermark / fill form) — use \`invoke_skill(name="pdf")\`.
  - Source is already an image file (.png/.jpg/...) — use \`read\` directly.

Input
  - input: path to the source PDF file.
  - page: 1-based page number to render. Single page only — call again for additional pages so each visual inspection is a deliberate choice.
  - output (optional): path to write the PNG. Default: <input>.p<page>.png next to the source.
  - dpi (optional): render DPI. 72-600. Default 200. Lower if the file is huge; higher if you need to read small print or fine seal detail.

Output (text returned to the agent)
  A short confirmation block ending with the absolute PNG path, plus an explicit reminder to call \`read\` on that path next.

Requires \`pdftoppm\` (poppler) on PATH.`;
