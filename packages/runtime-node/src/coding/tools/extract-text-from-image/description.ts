export const EXTRACT_TEXT_FROM_IMAGE_TOOL_DESCRIPTION = `Extract text from an image (PNG / JPG / WebP / BMP / GIF) using Vetta Desktop's local PP-OCRv5 runner.

Runs entirely locally — no network calls. Designed for screenshots, scanned single pages, photographed documents.

This tool calls the Vetta Desktop executable in command-line OCR mode. Vetta Desktop must be installed, or VETTA_DESKTOP_EXE must point to the desktop executable.

Input
  - input: path to an image file. Supported extensions: .png .jpg .jpeg .webp .bmp .gif
  - output (optional): path to write the structured JSON. Default: <input>.ocr.json next to the source.
  - max_chars (optional): truncate the returned text. Default 8000. The full text is always written to the output JSON.

Output (text returned to the agent)
  Recognized text followed by a metadata footer:
  - confidence (0..100, rough mapping of CTC logit, useful for relative comparison)
  - duration_ms, engine
  - output: absolute path to the full JSON

Limitations
  - Designed for printed text (Chinese + English). Handwriting, seals, and stylized fonts will be poor.
  - Tables are flattened into lines (column structure is lost).
  - Confidence is a coarse signal — don't gate decisions on a hard threshold.

When to use
  - You have a single image you need text from (screenshot of a document, scanned receipt, photo of a sign).

When NOT to use
  - You need a VISUAL judgment on the image — presence/absence of seals (盖章/印章), signatures, handwriting, logos, layout, color. OCR returns text only; call \`read\` on the image directly so a vision-capable model can look at it.
  - The image is a multi-page PDF — use \`extract_text_from_pdf\` (text) or \`render_pdf_page\` (visual).
  - You need layout / coordinates / table structure.`;
