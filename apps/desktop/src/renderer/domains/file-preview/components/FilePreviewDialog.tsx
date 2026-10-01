import { useThemeComponent } from "@astravia-org/theme-sdk";
import { useFilePreviewDialogModel } from "../hooks/useFilePreviewDialogModel";
import { FilePreviewDialogView } from "./FilePreviewDialogView";

export function FilePreviewDialog(): JSX.Element {
	const model = useFilePreviewDialogModel();
	const ThemedFilePreviewDialogView = useThemeComponent("root.filePreviewDialogView", FilePreviewDialogView);
	return <ThemedFilePreviewDialogView {...model} />;
}
