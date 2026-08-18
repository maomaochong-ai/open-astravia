import { FilesPanel } from "@domains/file-explorer/components/FilesPanel";
import { FilePreviewView } from "@domains/file-preview/components/FilePreviewView";
import { FileTabContentView } from "@vetta/theme-ui/activity";
import { useFileTabContentModel } from "../../hooks/useFileTabContentModel";

interface FileTabContentProps {
	cwd: string | null;
}

export function FileTabContent({ cwd }: FileTabContentProps): JSX.Element {
	const model = useFileTabContentModel();

	return (
		<FileTabContentView
			showTree={model.showTree}
			showPreview={model.showPreview}
			treeWidth={model.treeWidth}
			onTreeResize={model.onTreeResize}
			tree={<FilesPanel cwd={cwd} />}
			preview={
				model.showPreview && model.previewCtx ? (
					model.previewMounted ? (
						<FilePreviewView
							ctx={model.previewCtx}
							onPrev={model.goPrev}
							onNext={model.goNext}
							onClose={model.closePreview}
							canPrev={model.canPrev}
							canNext={model.canNext}
							enableKeyboard
							onToggleSidebar={model.toggleTree}
							sidebarCollapsed={model.treeCollapsed}
						/>
					) : (
						<div className="flex min-h-0 flex-1" />
					)
				) : null
			}
		/>
	);
}
