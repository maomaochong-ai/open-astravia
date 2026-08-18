import { KnowledgeBaseSwitcherView as ThemeKnowledgeBaseSwitcherView } from "@vetta/theme-ui/knowledge";
import type { KnowledgeBaseSwitcherModel } from "../hooks/useKnowledgeBaseSwitcherModel";
import { KnowledgeRenameDialog } from "./KnowledgeRenameDialog";

export function KnowledgeBaseSwitcherView(model: KnowledgeBaseSwitcherModel): JSX.Element {
	return (
		<ThemeKnowledgeBaseSwitcherView
			open={model.open}
			onOpenChange={model.onOpenChange}
			activeName={model.activeName}
			basesCount={model.basesCount}
			items={model.items}
			showManageCurrent={model.showManageCurrent}
			onSelect={model.onSelect}
			onStartRename={model.onStartRename}
			onConfirmDelete={model.onConfirmDelete}
			onViewAll={model.onViewAll}
			onCreate={model.onCreate}
			labels={model.labels}
			renameDialog={
				model.renaming ? (
					<KnowledgeRenameDialog
						title={model.labels.renameBaseTitle}
						initialName={model.activeName}
						onClose={() => model.setRenaming(false)}
						onSubmit={model.onRenameSubmit}
					/>
				) : null
			}
		/>
	);
}
