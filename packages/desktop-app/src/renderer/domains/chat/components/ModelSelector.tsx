import { useThemeComponent } from "@vetta/theme-sdk";
import { useModelSelectorModel } from "../hooks/useModelSelectorModel";
import { ModelSelectorView } from "@vetta/theme-ui/chat";

export function ModelSelector(): JSX.Element {
	const model = useModelSelectorModel();
	const ThemedModelSelectorView = useThemeComponent("chat.modelSelectorView", ModelSelectorView);
	if (model.empty) return <></>;
	return <ThemedModelSelectorView {...model.viewProps} />;
}
