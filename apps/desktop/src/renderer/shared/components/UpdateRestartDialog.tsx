import { useThemeComponent } from "@vetta/theme-sdk";
import { UpdateRestartDialogView } from "./UpdateRestartDialogView";
import { useUpdateRestartDialogModel } from "./useUpdateRestartDialogModel";

export function UpdateRestartDialog(): JSX.Element {
	const model = useUpdateRestartDialogModel();
	const ThemedUpdateRestartDialogView = useThemeComponent(
		"root.updateRestartDialogView",
		UpdateRestartDialogView,
	);
	return <ThemedUpdateRestartDialogView {...model} />;
}
