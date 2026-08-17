export const EXTRACT_TEXT_FROM_PDF_TOOL_DESCRIPTION = `Extract text from a PDF (scanned or born-digital) using Vetta Desktop's bundled OCR runner.

Pages with an embedded text layer are read directly (near-perfect accuracy, milliseconds per page). Pages without a usable text layer fall through to PP-OCRv5 (Chinese + English, ~1-2s per page on a modern machine). All work runs locally — no network calls.

This tool calls the Vetta Desktop executable in command-line OCR mode. Vetta Desktop must be installed, or VETTA_DESKTOP_EXE must point to the desktop executable.

Input
  - input: path to the PDF file
  - output (optional): path to write the full structured JSON result. Default: <input>.ocr.json next to the source.
  - pages (optional): "all" | "N" | "N-M". Default "all". For PDFs with many pages, prefer a range so you don't burn time on parts you don't need.
  - dpi (optional): render DPI for OCR fallback. Default 150. Lower values are faster and use less memory; higher values help small print. If OCR hits OOM, retry with a smaller DPI. When omitted, this tool may automatically lower DPI for oversized PDF pages so rendered images stay within a safer pixel size.
  - max_chars (optional): truncate the returned text at this many characters. Default 8000. The full text is always written to the output JSON.
  - prefer_text_layer (optional): try the embedded text layer first. Default true.

Output (text returned to the agent)
  Concatenated page text with \`=== Page N ===\` separators, truncated to max_chars. Followed by a metadata footer:
  - total_pages, processed_pages, text_layer_pages, ocr_pages, duration_ms
  - output: absolute path to the full JSON document

Limitations
  - Does not preserve table structure (rows/columns are flattened into lines).
  - Does not recognize handwriting, official seals/stamps, signatures, logos, or formula notation. OCR returns text only — it CANNOT tell you whether a stamp/signature is present, what color it is, or where it sits on the page.
  - Confidence numbers in the JSON are 0..100 but reflect a coarse mapping of CTC logits — use them for relative comparison between pages, not as a hard quality threshold.

When to use
  - You need the textual content of a scanned PDF or one whose text layer you suspect is unreliable.
  - You need a structured per-page JSON to feed downstream code (use the output file).

When NOT to use
  - You need a VISUAL judgment on the page — presence/absence of seals (盖章/印章/公章), signatures, handwriting, logos, layout, watermarks, figures, color. Use \`render_pdf_page\` to produce a PNG, then \`read\` that PNG. Do NOT call this tool hoping the text output will reveal a stamp — it will not.
  - You want to manipulate the PDF itself (merge/split/rotate/watermark/fill form). Use \`invoke_skill(name="pdf")\`.
  - The PDF clearly has a clean text layer and you only want raw text — \`read\` plus a PDF-text-extracting tool would be cheaper.
  - You need layout fidelity (PP-Structure / table extraction is out of scope here).`;
