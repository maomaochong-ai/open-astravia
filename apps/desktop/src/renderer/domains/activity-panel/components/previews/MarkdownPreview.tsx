import { useMarkdownHost } from "@shared/hooks/useMarkdownHost";
import { pathDirname } from "@shared/lib/utils";
import { resolveLocalFilePath } from "@shared/lib/resolve-local-file-path";
import { openReferencedFileAtom } from "@shared/store/file-preview-atoms";
import { MarkdownPreviewView } from "@astravia-org/theme-ui/activity/markdown-preview";
import { useSetAtom } from "jotai";
import { memo, useCallback } from "react";
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
	const openReferencedFile = useSetAtom(openReferencedFileAtom);

	// A document's relative links are relative to the document, not to the workspace: resolve
	// against the source file's own directory, then swap the preview in place instead of letting
	// the window navigate away.
	const onOpenLocalFile = useCallback(
		(path: string) => {
			if (!sourcePath) return;
			openReferencedFile({ from: sourcePath, path: resolveLocalFilePath(path, pathDirname(sourcePath)) });
		},
		[openReferencedFile, sourcePath],
	);

	return (
		<MarkdownPreviewView
			host={host}
			content={content}
			theme={model.theme}
			onOpenExternal={model.onOpenExternal}
			onOpenLocalFile={sourcePath ? onOpenLocalFile : undefined}
			labels={labels}
		/>
	);
});
