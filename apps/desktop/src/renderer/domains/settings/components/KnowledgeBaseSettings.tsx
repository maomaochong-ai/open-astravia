import { KnowledgeBaseSettingsView } from "./KnowledgeBaseSettingsView";
import { useKnowledgeBaseSettingsModel } from "./useKnowledgeBaseSettingsModel";

export function KnowledgeBaseSettings(): JSX.Element {
	const model = useKnowledgeBaseSettingsModel();
	return <KnowledgeBaseSettingsView model={model} />;
}
