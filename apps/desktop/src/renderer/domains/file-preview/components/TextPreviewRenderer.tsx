import { resolvedThemeAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { CodePreview } from "../../activity-panel/components/previews/CodePreview";
import { HtmlPreview } from "../../activity-panel/components/previews/HtmlPreview";
import { MarkdownPreview } from "../../activity-panel/components/previews/MarkdownPreview";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const SCROLL_WRAP = "text-preview-content min-h-0 flex-1 overflow-y-auto";

export function TextPreviewRenderer({
	content,
	extension,
}: {
	content: string;
	extension: string;
}): JSX.Element {
	const theme = useAtomValue(resolvedThemeAtom);
	if (extension === "html" || extension === "htm" || extension === "xhtml") {
		return <HtmlPreview content={content} theme={theme} />;
	}
	if (MARKDOWN_EXTENSIONS.has(extension)) {
		return (
			<div className={SCROLL_WRAP}>
				<MarkdownPreview content={content} />
			</div>
		);
	}
	let displayContent = content;
	if (extension === "json") {
		try {
			displayContent = JSON.stringify(JSON.parse(content), null, 2);
		} catch {
			// Keep invalid JSON editable and show it unchanged.
		}
	}
	return (
		<div className={SCROLL_WRAP}>
			<CodePreview content={displayContent} extension={extension} theme={theme} />
		</div>
	);
}
