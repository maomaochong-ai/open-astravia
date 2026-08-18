import {
	KnowledgeListView,
	type KnowledgeViewProps as ThemeKnowledgeViewProps,
} from "@vetta/theme-ui/knowledge";
import type { KnowledgeNode, KnowledgeProcessStatus } from "@shared/types/knowledge-base";
import { useKnowledgeViewLabels } from "./KnowledgeViewShared";

export interface KnowledgeListProps {
	nodes: KnowledgeNode[];
	searching: boolean;
	selectedIds: Set<string>;
	statusFor: (node: KnowledgeNode) => KnowledgeProcessStatus | null;
	onItemClick: (node: KnowledgeNode, event: React.MouseEvent) => void;
	onOpen: (node: KnowledgeNode) => void;
	onContextMenu: (node: KnowledgeNode, event: React.MouseEvent) => void;
	onSelectIds: (ids: Set<string>) => void;
	onClearSelection: () => void;
}

export function KnowledgeList(props: KnowledgeListProps): JSX.Element {
	const labels = useKnowledgeViewLabels();
	return <KnowledgeListView {...(props as ThemeKnowledgeViewProps)} labels={labels} />;
}
