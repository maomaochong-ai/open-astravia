import type { JSX } from "react";
import { QrBindDialogView, type QrBindDialogViewLabels } from "./QrBindDialogView";

/**
 * WeChat's QR bind dialog: the shared QrBindDialogView with the iLink
 * identity rows filled in. Kept as its own export so the wechat call site
 * (and its labels contract) stays unchanged.
 */
export type WechatBindDialogBodyKind = "bound" | "loading" | "failed" | "confirmed" | "qr";

export type WechatBindDialogViewLabels = QrBindDialogViewLabels;

export interface WechatBindDialogViewProps {
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly bodyKind: WechatBindDialogBodyKind;
	readonly bound: boolean;
	readonly error: string | null;
	readonly ilinkBotId: string | null;
	readonly ilinkUserId: string | null;
	readonly progressLabel: string;
	readonly qrDataUrl: string | null;
	readonly onStart: () => void;
	readonly onLogout: () => void;
	/** Optional footer control — the channel's "how this works" entry. */
	readonly footerExtra?: JSX.Element | null;
	readonly labels: WechatBindDialogViewLabels;
}

export function WechatBindDialogView({
	ilinkBotId,
	ilinkUserId,
	...rest
}: WechatBindDialogViewProps): JSX.Element {
	return (
		<QrBindDialogView
			{...rest}
			qrAlt="WeChat QR"
			details={[
				{ label: "ilink_bot_id", value: ilinkBotId ?? "—" },
				{ label: "ilink_user_id", value: ilinkUserId ?? "—" },
			]}
		/>
	);
}
