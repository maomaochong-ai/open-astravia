import type { JSX, ReactNode } from "react";

export interface RouteErrorPageViewLabels {
	readonly bannerTitle: string;
	readonly home: string;
	readonly pageTitle: string;
	readonly retry: string;
	readonly retryPage: string;
	readonly suggestion: string;
}

export interface RouteErrorPageViewProps {
	readonly homeAction: ReactNode;
	readonly labels: RouteErrorPageViewLabels;
	readonly message: string;
	readonly onRetry: () => void;
}

const buttonBase =
	"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export function RouteErrorPageView({
	homeAction,
	labels,
	message,
	onRetry,
}: RouteErrorPageViewProps): JSX.Element {
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

			<div className="flex flex-1 items-center justify-center px-6 py-10">
				<div className="flex w-full max-w-[420px] flex-col items-center text-center">
					<div className="flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
						<span className="icon-[mdi--page-next-outline] text-[24px]" aria-hidden="true" />
					</div>
					<h1 className="mt-4 text-[16px] font-semibold text-foreground">{labels.pageTitle}</h1>
					<p className="mt-2 text-[13px] leading-6 text-muted-foreground">{labels.suggestion}</p>

					<div className="mt-5 flex flex-wrap items-center justify-center gap-2">
						<button
							type="button"
							onClick={onRetry}
							className={`${buttonBase} h-8 gap-1.5 rounded-lg bg-primary px-2.5 text-[0.8rem] text-primary-foreground hover:bg-primary/90`}
						>
							{labels.retryPage}
						</button>
						{homeAction}
					</div>
				</div>
			</div>
		</div>
	);
}
