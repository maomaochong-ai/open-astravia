import katex from "katex";

export const MAX_FORMULA_LENGTH = 8192;

/** Called only in the worker; each formula gets its own macro scope. */
export function renderFormula(source: string, displayMode: boolean): string | null {
	if (source.length > MAX_FORMULA_LENGTH) return null;
	try {
		const html = katex.renderToString(source, {
			displayMode,
			output: "htmlAndMathml",
			trust: false,
			throwOnError: true,
			strict: "ignore",
			maxExpand: 500,
			maxSize: 20,
			macros: {},
		});
		return html.length <= 1_000_000 ? html : null;
	} catch {
		return null;
	}
}
