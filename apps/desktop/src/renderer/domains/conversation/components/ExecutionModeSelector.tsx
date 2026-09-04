import { useThemeComponent } from "@vetta/theme-sdk";
import { ExecutionModeSelectorView } from "./execution-mode-selector/ExecutionModeSelectorView";
import type { ExecutionModeSelectorViewProps } from "./execution-mode-selector/types";

export function ExecutionModeSelector({ model }: { readonly model: ExecutionModeSelectorViewProps }): JSX.Element {
	const ThemedExecutionModeSelectorView = useThemeComponent(
		"chat.executionModeSelectorView",
		ExecutionModeSelectorView,
	);
	return <ThemedExecutionModeSelectorView {...model} />;
}

export type { ExecutionModeSelectorViewProps } from "./execution-mode-selector/types";
