import { useKnowledgeBaseListModel } from "../hooks/useKnowledgeBaseListModel";
import { KnowledgeBaseListPageView } from "./KnowledgeBaseListPageView";

export function KnowledgeBaseListPage(): JSX.Element {
	const model = useKnowledgeBaseListModel();

	return <KnowledgeBaseListPageView model={model} />;
}
