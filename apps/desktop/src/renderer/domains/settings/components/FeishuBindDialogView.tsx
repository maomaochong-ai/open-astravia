import { QrBindDialogView } from "@vetta/theme-ui/settings";
import { Button } from "@vetta/ui";
import { ImChannelGuideButton } from "./ImChannelGuideButton";
import type { FeishuBindDialogModel } from "./useFeishuBindDialogModel";

export function FeishuBindDialogView(model: FeishuBindDialogModel): JSX.Element {
	const {
		appId,
		bodyKind,
		bound,
		error,
		labels,
		onLogout,
		onOpenChange,
		onOpenGuide,
		onOpenManual,
		onStart,
		open,
		progressLabel,
		qrDataUrl,
	} = model;

	return (
		<QrBindDialogView
			open={open}
			onOpenChange={onOpenChange}
			bodyKind={bodyKind}
			bound={bound}
			error={error ?? null}
			details={[{ label: labels.appIdLabel, value: appId ?? "—" }]}
			progressLabel={progressLabel}
			qrDataUrl={qrDataUrl ?? null}
			qrAlt={labels.qrAlt}
			footerExtra={
				<>
					<ImChannelGuideButton onOpen={onOpenGuide} />
					<Button
						variant="ghost"
						className="text-[11px] text-muted-foreground"
						onClick={() => {
							onOpenChange(false);
							onOpenManual();
						}}
					>
						{labels.manual}
					</Button>
				</>
			}
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
