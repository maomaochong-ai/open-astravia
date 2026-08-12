/**
 * 查看旧版本时压在画布顶部的横幅（ADR-0069）。
 *
 * 它必须一直在、一直显眼：画布此刻渲染的是一份旧版本，而画布看起来和平时一模一样。
 * 没有这条横幅，用户会以为自己的设计被改回去了。
 */
import { useTranslation } from "@vetta-org/plugin-sdk";

interface PeekBannerProps {
	title: string;
	busy: boolean;
	onExit(): void;
	onRestore(): void;
}

export function PeekBanner({ title, busy, onExit, onRestore }: PeekBannerProps) {
	const { t } = useTranslation();
	return (
		<div className="pointer-events-auto absolute inset-x-0 top-0 z-50 flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-2 backdrop-blur-md">
			<span className="size-1.5 shrink-0 rounded-full bg-primary" />
			<span className="min-w-0 flex-1 truncate text-xs text-foreground">
				<span className="font-medium">{t("history.peek.banner")}</span>
				<span className="text-muted-foreground">{title ? ` · ${title}` : ""}</span>
			</span>
			{/* 查看期间的改动会被丢弃，说在前面而不是事后解释。 */}
			<span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{t("history.peek.readonly")}</span>
			<button
				type="button"
				disabled={busy}
				onClick={onRestore}
				className="shrink-0 rounded-lg border border-border/70 bg-background/60 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-45"
			>
				{t("history.peek.keep")}
			</button>
			<button
				type="button"
				disabled={busy}
				onClick={onExit}
				className="shrink-0 rounded-lg bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-45"
			>
				{busy ? t("history.peek.exiting") : t("history.peek.exit")}
			</button>
		</div>
	);
}
