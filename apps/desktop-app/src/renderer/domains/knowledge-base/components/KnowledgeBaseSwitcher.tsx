import type { KnowledgeBase } from "@shared/types/knowledge-base";
import { useKnowledgeBaseSwitcherModel } from "../hooks/useKnowledgeBaseSwitcherModel";
import { KnowledgeBaseSwitcherView } from "./KnowledgeBaseSwitcherView";

export function KnowledgeBaseSwitcher(props: {
	bases: KnowledgeBase[];
	activeBase: KnowledgeBase;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onViewAll: () => void;
	onRenameBase: (newName: string) => void;
	onRequestDeleteBase: () => void;
}): JSX.Element {
	return <KnowledgeBaseSwitcherView {...useKnowledgeBaseSwitcherModel(props)} />;
}
