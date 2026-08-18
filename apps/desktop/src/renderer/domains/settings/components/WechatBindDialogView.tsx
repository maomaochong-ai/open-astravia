import { WechatBindDialogView as ThemeWechatBindDialogView } from "@vetta/theme-ui/settings";
import type { WechatBindDialogModel } from "./useWechatBindDialogModel";

export function WechatBindDialogView(model: WechatBindDialogModel): JSX.Element {
	const {
		bodyKind,
		bound,
		error,
		ilinkBotId,
		ilinkUserId,
		labels,
		onLogout,
		onOpenChange,
		onStart,
		open,
		progressLabel,
		qrDataUrl,
	} = model;

	return (
		<ThemeWechatBindDialogView
			open={open}
			onOpenChange={onOpenChange}
			bodyKind={bodyKind}
			bound={bound}
			error={error ?? null}
			ilinkBotId={ilinkBotId ?? null}
			ilinkUserId={ilinkUserId ?? null}
			progressLabel={progressLabel}
			qrDataUrl={qrDataUrl ?? null}
			onStart={onStart}
			onLogout={onLogout}
			labels={{
				title: labels.title,
				bindDesc: labels.bindDesc,
				bindGenerating: labels.bindGenerating,
				bindFailed: labels.bindFailed,
				retry: labels.retry,
				bindSuccessTitle: labels.bindSuccessTitle,
				bindSuccessDesc: labels.bindSuccessDesc,
				scanToAuthorize: labels.scanToAuthorize,
				unbindAccount: labels.unbindAccount,
				bindDone: labels.bindDone,
				cancel: labels.cancel,
			}}
		/>
	);
}
