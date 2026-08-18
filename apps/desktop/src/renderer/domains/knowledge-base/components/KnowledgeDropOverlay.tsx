import { useThemeComponent } from "@vetta/theme-sdk";
import { useKnowledgeDropOverlayModel } from "../hooks/useKnowledgeDropOverlayModel";
import { KnowledgeDropOverlayView } from "./KnowledgeDropOverlayView";

export function KnowledgeDropOverlay(): JSX.Element {
	const model = useKnowledgeDropOverlayModel();
	const ThemedKnowledgeDropOverlayView = useThemeComponent(
		"root.knowledgeDropOverlayView",
		KnowledgeDropOverlayView,
	);
	return <ThemedKnowledgeDropOverlayView {...model} />;
}
