import { SignalBindDialogView } from "./SignalBindDialogView";
import { useSignalBindDialogModel } from "./useSignalBindDialogModel";

export function SignalBindDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bound: boolean;
	account?: string;
	cliDetectedPath?: string;
	cliInstallHint: string;
	onLogout: () => void;
	onConfirmedRefresh: () => void;
	/** Open the advanced form for a self-hosted signal-cli daemon. */
	onOpenAdvanced: () => void;
	/** Open the channel's usage guide. */
	onOpenGuide: () => void;
}): JSX.Element {
	return <SignalBindDialogView {...useSignalBindDialogModel(props)} />;
}
