import { MarkdownPreviewView } from "@vetta/theme-ui/activity";
import { useMarkdownPreviewModel } from "../../hooks/useMarkdownPreviewModel";

interface MarkdownPreviewProps {
	content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps): JSX.Element {
	const model = useMarkdownPreviewModel();

	return (
		<MarkdownPreviewView content={content} theme={model.theme} onOpenExternal={model.onOpenExternal} />
	);
}
