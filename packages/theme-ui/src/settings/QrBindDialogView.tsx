import type { JSX } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta/ui";

/**
 * Shared QR device-binding dialog.
 *
 * Every channel that pairs by scanning a code (WeChat, Signal — WhatsApp
 * next) shows the same five bodies: the code, "generating", failure with a
 * retry, success, and the bound-account summary. Only the identity rows and
 * the wording differ, so those are props rather than a second copy of the
 * layout.
 */
export type QrBindDialogBodyKind = "bound" | "loading" | "failed" | "confirmed" | "qr";

/** One label/value row shown once the channel is bound. */
export interface QrBindDialogDetail {
	readonly label: string;
	readonly value: string;
}

export interface QrBindDialogViewLabels {
	readonly title: string;
	readonly bindDesc: string;
	readonly bindGenerating: string;
	readonly bindFailed: string;
	readonly retry: string;
	readonly bindSuccessTitle: string;
	readonly bindSuccessDesc: string;
	readonly scanToAuthorize: string;
	readonly unbindAccount: string;
	readonly bindDone: string;
	readonly cancel: string;
}

export interface QrBindDialogViewProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly bodyKind: QrBindDialogBodyKind;
	readonly bound: boolean;
	readonly error: string | null;
	/** Identity rows for the "bound" body, e.g. the paired account. */
	readonly details: readonly QrBindDialogDetail[];
	readonly progressLabel: string;
	readonly qrDataUrl: string | null;
	/** Alt text for the QR image; names the channel for screen readers. */
	readonly qrAlt: string;
	/**
	 * Optional callout rendered above the body — used for prerequisites the
	 * user must satisfy outside the app (e.g. "signal-cli 未安装").
	 */
	readonly notice?: JSX.Element | null;
	/**
	 * Optional controls rendered at the start of the footer — the channel's
	 * "how this works" entry and any channel-specific escape hatch (e.g.
	 * Signal's "connect my own signal-cli daemon" form). They live bottom
	 * left because the dialog's own close button owns the top right corner.
	 */
	readonly footerExtra?: JSX.Element | null;
	readonly onStart: () => void;
	readonly onLogout: () => void;
	readonly labels: QrBindDialogViewLabels;
}

export function QrBindDialogView({
	open,
	onOpenChange,
	bodyKind,
	bound,
	error,
	details,
	progressLabel,
	qrDataUrl,
	qrAlt,
	notice,
	footerExtra,
	onStart,
	onLogout,
	labels,
}: QrBindDialogViewProps): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[460px]">
				<DialogHeader>
					<DialogTitle>{labels.title}</DialogTitle>
					<DialogDescription>{labels.bindDesc}</DialogDescription>
				</DialogHeader>

				{notice}

				{bodyKind === "bound" ? (
					<div className="space-y-3 py-2 text-[12px] text-foreground">
						{details.map((detail) => (
							<div key={detail.label} className="rounded-md border border-input bg-secondary px-3 py-2">
								<div className="text-muted-foreground">{detail.label}</div>
								<div className="break-all font-mono text-[11px]">{detail.value}</div>
							</div>
						))}
					</div>
				) : bodyKind === "loading" ? (
					<div className="flex flex-col items-center gap-3 py-10 text-center text-[12px] text-muted-foreground">
						<span className="icon-[mdi--loading] h-6 w-6 animate-spin" />
						<div>{labels.bindGenerating}</div>
					</div>
				) : bodyKind === "failed" ? (
					<div className="flex flex-col items-center gap-3 py-6 text-center">
						<span className="icon-[mdi--close-circle] h-10 w-10 text-destructive" />
						<div className="text-[12px] text-destructive">{error ?? labels.bindFailed}</div>
						<Button variant="primary" onClick={onStart}>
							{labels.retry}
						</Button>
					</div>
				) : bodyKind === "confirmed" ? (
					<div className="flex flex-col items-center gap-3 py-8 text-center">
						<span className="icon-[mdi--check-circle] h-12 w-12 text-emerald-400" />
						<div className="text-[13px] font-medium text-foreground">{labels.bindSuccessTitle}</div>
						<div className="text-[11px] text-muted-foreground">{labels.bindSuccessDesc}</div>
					</div>
				) : (
					<div className="flex flex-col items-center gap-3 py-3">
						<div className="flex h-[252px] w-[252px] items-center justify-center rounded-md border border-border bg-white p-1.5">
							{qrDataUrl ? (
								<img src={qrDataUrl} alt={qrAlt} className="h-full w-full" />
							) : (
								<span className="icon-[mdi--loading] h-8 w-8 animate-spin text-muted-foreground" />
							)}
						</div>
						<div className="text-center text-[12px] text-muted-foreground">{progressLabel}</div>
						<div className="text-center text-[11px] text-muted-foreground">{labels.scanToAuthorize}</div>
					</div>
				)}

				{/* justify-between only when there ARE extra controls —
				    otherwise the plain two-button footer would spread. */}
				<DialogFooter className={footerExtra ? "gap-2 sm:justify-between" : "gap-2"}>
					{footerExtra && <div className="flex items-center gap-1">{footerExtra}</div>}
					{/* 动作按钮成组，justify-between 才是「说明 | 动作」两端分布。 */}
					<div className="flex items-center gap-2">
						{bound ? (
							<>
								<Button variant="destructive" onClick={onLogout}>
									{labels.unbindAccount}
								</Button>
								<Button variant="primary" onClick={() => onOpenChange(false)}>
									{labels.bindDone}
								</Button>
							</>
						) : (
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								{labels.cancel}
							</Button>
						)}
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
