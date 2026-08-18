import { Button, Spin } from "@vetta/ui";
import type { OAuthLoginPhase } from "../hooks/useOAuthLogin";

export interface LoginPopoverViewLabels {
	readonly retry: string;
	readonly reopen: string;
	readonly waitingHint: string;
	readonly waitingTitle: string;
}

export interface LoginPopoverViewProps {
	readonly error: string;
	readonly labels: LoginPopoverViewLabels;
	readonly onReopen: () => void;
	readonly onRetry: () => void;
	readonly phase: OAuthLoginPhase;
}

export function LoginPopoverView({ error, labels, onReopen, onRetry, phase }: LoginPopoverViewProps): JSX.Element {
	// 失败态（浏览器没起来 / 回调 state 校验不过）给重试；其余时候都在等浏览器。
	if (error) {
		return (
			<div className="flex flex-col items-start gap-2 p-3 text-left">
				<div className="flex items-start gap-2">
					<span className="icon-[solar--danger-circle-linear] mt-px h-4 w-4 shrink-0 text-destructive" />
					<p className="text-[12px] leading-snug text-foreground">{error}</p>
				</div>
				<Button size="sm" className="h-7 rounded-md px-2.5 text-[12px]" onClick={onRetry}>
					{labels.retry}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-start gap-2 p-3 text-left">
			<div className="flex items-center gap-2.5">
				<Spin size="sm" className="text-primary" />
				<div className="min-w-0">
					<p className="text-[12px] font-medium leading-snug text-foreground">{labels.waitingTitle}</p>
					<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{labels.waitingHint}</p>
				</div>
			</div>
			<Button
				variant="ghost"
				size="sm"
				className="-ml-1.5 h-7 rounded-md px-1.5 text-[11px] text-muted-foreground"
				disabled={phase !== "waiting"}
				onClick={onReopen}
			>
				{labels.reopen}
			</Button>
		</div>
	);
}
