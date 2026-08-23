/**
 * Minimal PDF writer: one full-bleed JPEG per page, nothing else.
 *
 * Hand-rolled rather than pulled from a library — the document is a handful of
 * dictionaries around already-encoded JPEG bytes, which PDF embeds verbatim via
 * DCTDecode, so a dependency would only add weight.
 */

export interface PdfPageImage {
	/** JPEG bytes, embedded as-is. */
	jpeg: Uint8Array;
	/** Pixel size, used for the page aspect ratio. */
	width: number;
	height: number;
}

/**
 * @param pageWidth Uniform page width in points; every page keeps its own
 * aspect ratio, so heights differ but the stack reads as one document.
 */
export function buildImagePdf(pages: PdfPageImage[], pageWidth: number): Uint8Array {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const offsets: number[] = [];
	let length = 0;

	const push = (chunk: Uint8Array | string): void => {
		const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
		chunks.push(bytes);
		length += bytes.length;
	};
	const startObject = (id: number): void => {
		offsets[id] = length;
		push(`${id} 0 obj\n`);
	};

	// 1 catalog, 2 page tree, then image/contents/page per page.
	const objectId = (index: number, kind: 0 | 1 | 2): number => 3 + index * 3 + kind;
	const total = 2 + pages.length * 3;

	// The binary comment tells readers the file is not plain ASCII.
	push("%PDF-1.4\n%âãÏÓ\n");

	startObject(1);
	push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

	startObject(2);
	const kids = pages.map((_, index) => `${objectId(index, 2)} 0 R`).join(" ");
	push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);

	pages.forEach((page, index) => {
		const height = page.width > 0 ? (pageWidth * page.height) / page.width : pageWidth;
		const w = pageWidth.toFixed(2);
		const h = height.toFixed(2);

		startObject(objectId(index, 0));
		push(
			`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
				`/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
		);
		push(page.jpeg);
		push("\nendstream\nendobj\n");

		const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
		startObject(objectId(index, 1));
		push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

		startObject(objectId(index, 2));
		push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
				`/Resources << /XObject << /Im0 ${objectId(index, 0)} 0 R >> >> ` +
				`/Contents ${objectId(index, 1)} 0 R >>\nendobj\n`,
		);
	});

	const xrefOffset = length;
	push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
	for (let id = 1; id <= total; id += 1) {
		push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
	}
	push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

	const out = new Uint8Array(length);
	let cursor = 0;
	for (const chunk of chunks) {
		out.set(chunk, cursor);
		cursor += chunk.length;
	}
	return out;
}
