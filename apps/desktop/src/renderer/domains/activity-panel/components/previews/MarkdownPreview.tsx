import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { memo } from "react";
import { useMarkdownLabels } from "@shared/hooks/useMarkdownLabels";
import { useMarkdownPreviewModel } from "../../hooks/useMarkdownPreviewModel";

interface MarkdownPreviewProps {
	content: string;
}

export const MarkdownPreview = memo(function MarkdownPreview({ content }: MarkdownPreviewProps): JSX.Element {
	const model = useMarkdownPreviewModel();
	const labels = useMarkdownLabels();

	return (
		<MarkdownPreviewView content={content} theme={model.theme} onOpenExternal={model.onOpenExternal} labels={labels} />
	);
});
