import { useThemeComponent } from "@vetta/theme-sdk";
import { useFilePreviewDialogModel } from "../hooks/useFilePreviewDialogModel";
import { FilePreviewDialogView } from "./FilePreviewDialogView";

export function FilePreviewDialog(): JSX.Element {
	const model = useFilePreviewDialogModel();
	const ThemedFilePreviewDialogView = useThemeComponent("root.filePreviewDialogView", FilePreviewDialogView);
	return <ThemedFilePreviewDialogView {...model} />;
}
