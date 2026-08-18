import { useWechatBindDialogModel } from "./useWechatBindDialogModel";
import { WechatBindDialogView } from "./WechatBindDialogView";

export function WechatBindDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bound: boolean;
	ilinkBotId?: string;
	ilinkUserId?: string;
	onLogout: () => void;
	onConfirmedRefresh: () => void;
}): JSX.Element {
	return <WechatBindDialogView {...useWechatBindDialogModel(props)} />;
}
