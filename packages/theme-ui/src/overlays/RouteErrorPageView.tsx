import type { JSX, ReactNode } from "react";

export interface RouteErrorPageViewLabels {
	readonly bannerTitle: string;
	readonly detailsToggle: string;
	readonly home: string;
	readonly pageTitle: string;
	readonly reloadWindow: string;
	readonly retry: string;
	readonly retryPage: string;
	readonly suggestion: string;
}

/** 主按钮放哪个动作：重试（默认）还是重新加载窗口。update-depth 这类错误重试无效。 */
export type RouteErrorPagePreferredAction = "reload" | "retry";

export interface RouteErrorPageViewProps {
	/** 技术细节（原始错误 + 组件栈），展开后显示。调用方按用户语言组织好，没有就传 null。 */
	readonly details?: string | null;
	readonly homeAction: ReactNode;
	readonly labels: RouteErrorPageViewLabels;
	/** 顶部横幅下的一句话说明：已知错误给归类后的解释，未知错误给原始 message。 */
	readonly message: string;
	readonly onReloadWindow: () => void;
	readonly onRetry: () => void;
	readonly preferredAction?: RouteErrorPagePreferredAction;
}

const buttonBase =
	"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50";

const primaryButton = `${buttonBase} h-8 gap-1.5 rounded-lg bg-primary px-2.5 text-[0.8rem] text-primary-foreground hover:bg-primary/90`;
const secondaryButton = `${buttonBase} h-8 gap-1.5 rounded-lg border-border px-2.5 text-[0.8rem] text-foreground hover:bg-muted`;

export function RouteErrorPageView({
	details = null,
	homeAction,
	labels,
	message,
	onReloadWindow,
	onRetry,
	preferredAction = "retry",
}: RouteErrorPageViewProps): JSX.Element {
	const retryAction = (
		<button
			type="button"
			onClick={onRetry}
			className={preferredAction === "retry" ? primaryButton : secondaryButton}
		>
			{labels.retryPage}
		</button>
	);
	const reloadAction = (
		<button
			type="button"
			onClick={onReloadWindow}
			className={preferredAction === "reload" ? primaryButton : secondaryButton}
		>
			<span className="icon-[mdi--reload] text-[14px]" aria-hidden="true" />
			{labels.reloadWindow}
		</button>
	);

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
			<div className="pointer-events-none fixed left-1/2 top-4 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2">
				<div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-destructive/25 bg-background/95 px-4 py-3 text-[13px] shadow-lg backdrop-blur">
					<span
						className="icon-[mdi--alert-circle-outline] mt-0.5 h-4 w-4 shrink-0 text-destructive"
						aria-hidden="true"
					/>
					<div className="min-w-0 flex-1">
						<p className="font-medium text-foreground">{labels.bannerTitle}</p>
						<p className="mt-1 break-words text-[12px] leading-5 text-muted-foreground">{message}</p>
					</div>
					<button
						type="button"
						onClick={onRetry}
						className={`${buttonBase} h-6 gap-1 rounded-md px-2 text-[0.75rem] hover:bg-muted hover:text-foreground`}
					>
						{labels.retry}
					</button>
				</div>
			</div>

			<div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
				<div className="flex w-full max-w-[480px] flex-col items-center text-center">
					<div className="flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
						<span className="icon-[mdi--page-next-outline] text-[24px]" aria-hidden="true" />
					</div>
					<h1 className="mt-4 text-[16px] font-semibold text-foreground">{labels.pageTitle}</h1>
					<p className="mt-2 text-[13px] leading-6 text-muted-foreground">{labels.suggestion}</p>

					<div className="mt-5 flex flex-wrap items-center justify-center gap-2">
						{preferredAction === "reload" ? (
							<>
								{reloadAction}
								{retryAction}
							</>
						) : (
							<>
								{retryAction}
								{reloadAction}
							</>
						)}
						{homeAction}
					</div>

					{details ? (
						// 原生 details：不引入状态，键盘与读屏都能直接用。
						<details className="mt-6 w-full text-left">
							<summary className="cursor-pointer list-none text-center text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
								{labels.detailsToggle}
							</summary>
							<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/40 p-2.5 text-[11px] leading-5 text-muted-foreground">
								{details}
							</pre>
						</details>
					) : null}
				</div>
			</div>
		</div>
	);
}
