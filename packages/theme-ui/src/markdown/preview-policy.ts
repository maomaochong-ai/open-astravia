export const MAX_PREVIEW_LENGTH = 256_000;
export const MARKDOWN_PREVIEW_FRAME_NAME = "vetta-markdown-preview";

/** No same-origin, popups, forms, downloads, navigation of ancestors or host bridge. */
export function createPreviewDocument(source: string, scripts: boolean): string {
	const policy = [
		"default-src 'none'",
		`script-src ${scripts ? "'unsafe-inline'" : "'none'"}`,
		"style-src 'unsafe-inline'",
		"img-src data: blob:",
		"font-src data:",
		"connect-src 'none'",
		"frame-src 'none'",
		"worker-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
	// The trusted outer frame also restricts child navigation. A child's own CSP alone
	// cannot prevent scripts assigning location or a meta refresh from navigating itself.
	const document = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">${source}`;
	const escaped = document
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	const outerPolicy = policy.replace("frame-src 'none'", "frame-src about:");
	return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${outerPolicy}"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{overflow:hidden}</style><iframe title="HTML" sandbox="${scripts ? "allow-scripts" : ""}" referrerpolicy="no-referrer" srcdoc="${escaped}"></iframe>`;
}

export function svgImageSource(source: string): string | null {
	if (source.length > MAX_PREVIEW_LENGTH) return null;
	// SVG image mode disables scripts and external resources, unlike inserting SVG into the host DOM.
	const image = source.replace(/<svg\b([^>]*)>/i, (tag: string, attributes: string) =>
		/\bxmlns\s*=/.test(attributes) ? tag : `<svg xmlns="http://www.w3.org/2000/svg"${attributes}>`,
	);
	try {
		return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`;
	} catch {
		// A partial UTF-16 pair in a streamed/model-supplied string must not crash the message tree.
		return null;
	}
}
