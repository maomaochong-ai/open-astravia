import { useMemo, useState, type JSX } from "react";

export interface HtmlPreviewViewProps {
	readonly content: string;
	/**
	 * Kept for call-site compatibility. Preview canvas does not follow app theme —
	 * page CSS owns appearance; chrome uses a fixed light document color-scheme.
	 */
	readonly theme?: "light" | "dark";
	/** Accessible name for the iframe. */
	readonly title: string;
}

/**
 * Match packages/site `globals.css` thin scrollbar (6px rounded thumb).
 * Must live inside the iframe document — parent CSS never applies to srcDoc.
 *
 * Why body scroll (not the viewport root):
 * On Windows Chromium, `::-webkit-scrollbar` often fails to style the
 * documentElement/viewport scroller inside iframes, so the OS classic bar
 * shows. Pin html height + scroll body so webkit pseudo-elements apply.
 *
 * Fixed light chrome (not app theme): injecting color-scheme:dark forces UA
 * defaults (canvas/text) onto pages that omit their own background.
 */
function previewChromeStyle(): string {
	const thumb = "rgba(82, 82, 82, 0.28)";
	const thumbHover = "rgba(24, 24, 27, 0.48)";
	return `
:root { color-scheme: light; }
html {
  height: 100%;
  overflow: hidden;
}
/* Override preview HTML min-height:100vh so body is the scroller. */
html body {
  height: 100% !important;
  min-height: 0 !important;
  max-height: 100%;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: thin;
  scrollbar-color: ${thumb} transparent;
}
/* Also style nested overflow nodes (match .vetta-app-ui * on the host). */
html body * {
  scrollbar-width: thin;
  scrollbar-color: ${thumb} transparent;
}
html body::-webkit-scrollbar,
html body *::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
html body::-webkit-scrollbar-track,
html body *::-webkit-scrollbar-track {
  background: transparent;
}
html body::-webkit-scrollbar-thumb,
html body *::-webkit-scrollbar-thumb {
  min-height: 48px;
  border-radius: 999px;
  background-color: ${thumb};
}
html body::-webkit-scrollbar-thumb:hover,
html body *::-webkit-scrollbar-thumb:hover {
  background-color: ${thumbHover};
}
html body::-webkit-scrollbar-corner,
html body *::-webkit-scrollbar-corner {
  background: transparent;
}
`.trim();
}

/**
 * Inject chrome CSS into a full HTML document's <head> (last wins over page CSS).
 * Prepending before <!DOCTYPE> is dropped by browsers and never applies.
 */
function injectPreviewChrome(content: string): string {
	const styleTag = `<style data-preview-chrome>${previewChromeStyle()}</style>`;
	if (/<\/head>/i.test(content)) {
		return content.replace(/<\/head>/i, `${styleTag}</head>`);
	}
	if (/<head(\s[^>]*)?>/i.test(content)) {
		return content.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${styleTag}`);
	}
	if (/<html(\s[^>]*)?>/i.test(content)) {
		return content.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${styleTag}</head>`);
	}
	// Fragment / incomplete HTML — wrap so body rules still match.
	return `<!DOCTYPE html><html><head>${styleTag}</head><body>${content}</body></html>`;
}

function HtmlPreviewFrame({
	srcDoc,
	title,
}: {
	readonly srcDoc: string;
	readonly title: string;
}): JSX.Element {
	const [loadedSrcDoc, setLoadedSrcDoc] = useState<string | null>(null);
	const loaded = loadedSrcDoc === srcDoc;

	return (
		<div aria-busy={!loaded} className="relative min-h-0 w-full flex-1 bg-white">
			<iframe
				title={title}
				srcDoc={srcDoc}
				sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
				onLoad={() => setLoadedSrcDoc(srcDoc)}
				className={`absolute inset-0 h-full w-full border-0 bg-white ${
					loaded ? "opacity-100" : "opacity-0"
				}`}
				style={{ colorScheme: "light" }}
			/>
		</div>
	);
}

/**
 * Pure HTML render surface (iframe + srcDoc). Source editing lives in the host
 * text editor layer (edit mode) — this view has no nested preview/code chrome.
 * Does not follow app light/dark theme; the HTML document owns its look.
 */
export function HtmlPreviewView({ content, title }: HtmlPreviewViewProps): JSX.Element {
	const srcDoc = useMemo(() => injectPreviewChrome(content), [content]);

	return (
		<div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
			{/* iframe ignores flex-grow in many engines — absolute fill matches parent height. */}
			<HtmlPreviewFrame srcDoc={srcDoc} title={title} />
		</div>
	);
}
