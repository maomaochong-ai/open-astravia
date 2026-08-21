import { FeishuBindDialogView } from "./FeishuBindDialogView";
import { useFeishuBindDialogModel } from "./useFeishuBindDialogModel";

export function FeishuBindDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bound: boolean;
	appId?: string;
	onLogout: () => void;
	onConfirmedRefresh: () => void;
	/** Open the typed App ID / App Secret form. */
	onOpenManual: () => void;
	/** Open the channel's usage guide. */
	onOpenGuide: () => void;
}): JSX.Element {
	return <FeishuBindDialogView {...useFeishuBindDialogModel(props)} />;
}
