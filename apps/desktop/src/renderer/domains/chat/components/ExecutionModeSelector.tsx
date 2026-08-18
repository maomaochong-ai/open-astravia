import { useThemeComponent } from "@vetta/theme-sdk";
import { ExecutionModeSelectorView } from "./execution-mode-selector/ExecutionModeSelectorView";
import { useExecutionModeSelectorModel } from "../hooks/useExecutionModeSelectorModel";

export function ExecutionModeSelector(): JSX.Element {
	const viewProps = useExecutionModeSelectorModel();
	const ThemedExecutionModeSelectorView = useThemeComponent(
		"chat.executionModeSelectorView",
		ExecutionModeSelectorView,
	);
	return <ThemedExecutionModeSelectorView {...viewProps} />;
}

export type { ExecutionModeSelectorViewProps } from "./execution-mode-selector/types";
