import { useMarkdownHost } from "@shared/hooks/useMarkdownHost";
import { pathDirname } from "@shared/lib/utils";
import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { memo } from "react";
import { useMarkdownLabels } from "@shared/hooks/useMarkdownLabels";
import { useMarkdownPreviewModel } from "../../hooks/useMarkdownPreviewModel";

interface MarkdownPreviewProps {
	content: string;
	sourcePath?: string;
}

export const MarkdownPreview = memo(function MarkdownPreview({ content, sourcePath }: MarkdownPreviewProps): JSX.Element {
	const model = useMarkdownPreviewModel();
	const labels = useMarkdownLabels();
	const host = useMarkdownHost(sourcePath ? pathDirname(sourcePath) : null);

	return (
		<MarkdownPreviewView host={host} content={content} theme={model.theme} onOpenExternal={model.onOpenExternal} labels={labels} />
	);
});
