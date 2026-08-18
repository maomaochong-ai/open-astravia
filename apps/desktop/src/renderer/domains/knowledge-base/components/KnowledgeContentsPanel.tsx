import type { KnowledgeBase } from "@shared/types/knowledge-base";
import { useKnowledgeContentsModel } from "../hooks/useKnowledgeContentsModel";
import { KnowledgeContentsPanelView } from "./KnowledgeContentsPanelView";

interface KnowledgeContentsPanelProps {
	knowledgeBase: KnowledgeBase;
	search: string;
	onPickFiles: () => void;
	onPickFolders: () => void;
}

export function KnowledgeContentsPanel({
	knowledgeBase,
	search,
	onPickFiles,
	onPickFolders,
}: KnowledgeContentsPanelProps): JSX.Element {
	const model = useKnowledgeContentsModel({ knowledgeBase, search });

	return (
		<KnowledgeContentsPanelView
			hasNodes={knowledgeBase.nodes.length > 0}
			model={model}
			onPickFiles={onPickFiles}
			onPickFolders={onPickFolders}
		/>
	);
}
