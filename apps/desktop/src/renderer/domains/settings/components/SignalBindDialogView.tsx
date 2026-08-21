import { QrBindDialogView } from "@vetta/theme-ui/settings";
import { Button } from "@vetta/ui";
import { ImChannelGuideButton } from "./ImChannelGuideButton";
import type { SignalBindDialogModel } from "./useSignalBindDialogModel";

export function SignalBindDialogView(model: SignalBindDialogModel): JSX.Element {
	const {
		account,
		bodyKind,
		bound,
		cliMissing,
		error,
		labels,
		onLogout,
		onOpenAdvanced,
		onOpenGuide,
		onOpenChange,
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
			details={[{ label: labels.accountLabel, value: account ?? "—" }]}
			progressLabel={progressLabel}
			qrDataUrl={qrDataUrl ?? null}
			qrAlt={labels.qrAlt}
			notice={
				cliMissing ? (
					<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
						<div className="font-medium">{labels.cliMissingTitle}</div>
						<div className="mt-1 break-all text-[11px]">{labels.cliMissingDesc}</div>
					</div>
				) : null
			}
			footerExtra={
				<>
					<ImChannelGuideButton onOpen={onOpenGuide} />
					<Button
						variant="ghost"
						className="text-[11px] text-muted-foreground"
						onClick={() => {
							onOpenChange(false);
							onOpenAdvanced();
						}}
					>
						{labels.advanced}
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
