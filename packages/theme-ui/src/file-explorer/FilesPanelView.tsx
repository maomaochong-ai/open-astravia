import type { JSX, ReactNode } from "react";

export interface FilesPanelViewLabels {
	selectProject: string;
	headerTitle: string;
}

export interface FilesPanelViewProps {
	/** Null when no project root — empty state. */
	rootDir: string | null;
	labels: FilesPanelViewLabels;
	/** Host clear-artifacts Button (optional). */
	clearArtifactsButton?: ReactNode;
	/** Host refresh Button. */
	refreshButton: ReactNode;
	/** Plugin-contributed toolbar actions. */
	toolbarActions?: ReactNode;
	/** Loading spinner for root. */
	loadingRoot: boolean;
	/** FileTree (or spinner already handled). */
	tree: ReactNode;
	/** Context menu overlay. */
	contextMenu: ReactNode;
	/** Delete confirm overlay. */
	deleteDialog: ReactNode;
	transferDialog: ReactNode;
	/** Error toast text. */
	errorToast: string | null;
}

/**
 * Files panel chrome: header + tree slot + overlays.
 */
export function FilesPanelView({
	rootDir,
	labels,
	clearArtifactsButton,
	refreshButton,
	toolbarActions,
	loadingRoot,
	tree,
	contextMenu,
	deleteDialog,
	transferDialog,
	errorToast,
}: FilesPanelViewProps): JSX.Element {
	if (!rootDir) {
		return (
			<div className="flex flex-col items-center gap-2.5 px-4 py-10 text-center">
				<span className="icon-[solar--folder-with-files-linear] h-8 w-8 text-muted-foreground" />
				<p className="text-[11px] text-foreground">{labels.selectProject}</p>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-center justify-between px-3 py-1.5">
				<span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					{labels.headerTitle}
				</span>
				<div className="flex items-center gap-0.5">
					{clearArtifactsButton}
					{toolbarActions}
					{refreshButton}
				</div>
			</div>

			{/* Tree owns its own scroll + marquee; keep this a height-constrained flex child. */}
			<div className="min-h-0 flex-1 overflow-hidden">
				{loadingRoot ? (
					<div className="flex h-full items-center justify-center py-8">
						<span className="icon-[solar--refresh-linear] h-5 w-5 animate-spin text-muted-foreground" />
					</div>
				) : (
					tree
				)}
			</div>

			{contextMenu}
			{deleteDialog}
			{transferDialog}

			{errorToast && (
				<div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-destructive px-3 py-1.5 text-[12px] text-white shadow-lg">
					{errorToast}
				</div>
			)}
		</div>
	);
}
