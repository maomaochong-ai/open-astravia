import { useTranslation } from "react-i18next";
import { KnowledgeContentsPanelView as ThemeKnowledgeContentsPanelView } from "@vetta/theme-ui/knowledge";
import type { useKnowledgeContentsModel } from "../hooks/useKnowledgeContentsModel";
import { KnowledgeBreadcrumb } from "./KnowledgeBreadcrumb";
import { KnowledgeContextMenu } from "./KnowledgeContextMenu";
import { KnowledgeFilesSkeleton } from "./KnowledgeFilesSkeleton";
import { KnowledgeGrid } from "./KnowledgeGrid";
import { KnowledgeList } from "./KnowledgeList";
import { KnowledgeRenameDialog } from "./KnowledgeRenameDialog";
import { KnowledgeSourcePicker } from "./KnowledgeSourcePicker";

interface KnowledgeContentsPanelViewProps {
	hasNodes: boolean;
	model: ReturnType<typeof useKnowledgeContentsModel>;
	onPickFiles: () => void;
	onPickFolders: () => void;
}

export function KnowledgeContentsPanelView({
	hasNodes,
	model,
	onPickFiles,
	onPickFolders,
}: KnowledgeContentsPanelViewProps): JSX.Element {
	const { t } = useTranslation("settings");
	const View = model.viewMode === "list" ? KnowledgeList : KnowledgeGrid;

	return (
		<ThemeKnowledgeContentsPanelView
			breadcrumb={
				model.path.length > 0 ? (
					<KnowledgeBreadcrumb
						baseName={model.baseName}
						path={model.path}
						onNavigate={model.navigateBreadcrumb}
					/>
				) : null
			}
			empty={!hasNodes}
			emptyTitle={t("kbEmptyBaseTitle")}
			emptyDescription={t("kbEmptyBaseDesc")}
			emptyActions={<KnowledgeSourcePicker onPickFiles={onPickFiles} onPickFolders={onPickFolders} />}
			onBackgroundClick={(event) =>
				model.onBackgroundClick(event as unknown as React.MouseEvent)
			}
			skeleton={hasNodes && model.levelPending ? <KnowledgeFilesSkeleton /> : undefined}
			content={
				hasNodes && !model.levelPending ? (
					<View
						nodes={model.visibleNodes}
						searching={model.query.length > 0}
						selectedIds={model.selectedIds}
						statusFor={model.statusFor}
						onItemClick={model.onItemClick}
						onOpen={model.openNode}
						onContextMenu={model.onContextMenu}
						onSelectIds={model.setSelectedIds}
						onClearSelection={model.clearSelection}
					/>
				) : null
			}
			contextMenu={
				model.menu ? (
					<KnowledgeContextMenu
						x={model.menu.x}
						y={model.menu.y}
						items={model.menuItems}
						onClose={() => model.setMenu(null)}
					/>
				) : null
			}
			renameDialog={
				model.renameNode ? (
					<KnowledgeRenameDialog
						title={t("kbMenuRename")}
						initialName={model.renameNode.name}
						onClose={() => model.setRenameNode(null)}
						onSubmit={model.submitRename}
					/>
				) : null
			}
		/>
	);
}
