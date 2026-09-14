import { useThemeComponent } from "@vetta-org/theme-sdk";
import { type ModelSelectorScope, useModelSelectorModel } from "../hooks/useModelSelectorModel";
import { ModelSelectorView } from "@vetta-org/theme-ui/chat";

export function ModelSelector({
	updateActiveSession = true,
	scope,
}: {
	readonly updateActiveSession?: boolean;
	readonly scope?: ModelSelectorScope;
} = {}): JSX.Element {
	const model = useModelSelectorModel({ updateActiveSession, scope });
	const ThemedModelSelectorView = useThemeComponent("chat.modelSelectorView", ModelSelectorView);
	if (model.empty) return <></>;
	return <ThemedModelSelectorView {...model.viewProps} />;
}
