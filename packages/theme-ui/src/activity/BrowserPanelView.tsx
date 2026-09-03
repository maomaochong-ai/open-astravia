import type { FormEvent, JSX, Ref } from "react";

export interface BrowserPanelLabels {
	noSession: string;
	back: string;
	forward: string;
	stop: string;
	reload: string;
	addressPlaceholder: string;
	openExternal: string;
	empty: string;
	loading: string;
	failed: string;
	retry: string;
}

export interface BrowserPanelViewProps {
	/** Null when the host has no bound workspace — show empty state. */
	workspaceId: string | null;
	labels: BrowserPanelLabels;
	address: string;
	canBack: boolean;
	canForward: boolean;
	loading: boolean;
	failed: boolean;
	hasPage: boolean;
	currentUrl: string;
	partition: string;
	webviewRef: Ref<HTMLElement>;
	onAddressChange: (value: string) => void;
	onAddressSubmit: (event: FormEvent) => void;
	onBack: () => void;
	onForward: () => void;
	onStop: () => void;
	onReload: () => void;
	onOpenExternal: () => void;
	onRetry: () => void;
}

function ToolbarButton({
	icon,
	title,
	disabled,
	onClick,
}: {
	icon: string;
	title: string;
	disabled?: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			disabled={disabled}
			onClick={onClick}
			className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
		>
			<span className={`${icon} h-4 w-4`} />
		</button>
	);
}

/**
 * Session-scoped built-in browser shell. Host owns webview event wiring via ref.
 */
export function BrowserPanelView({
	workspaceId,
	labels,
	address,
	canBack,
	canForward,
	loading,
	failed,
	hasPage,
	currentUrl,
	partition,
	webviewRef,
	onAddressChange,
	onAddressSubmit,
	onBack,
	onForward,
	onStop,
	onReload,
	onOpenExternal,
	onRetry,
}: BrowserPanelViewProps): JSX.Element {
	if (!workspaceId) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[12px] text-muted-foreground/60">
				{labels.noSession}
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 py-1.5">
				<ToolbarButton icon="icon-[mdi--arrow-left]" title={labels.back} disabled={!canBack} onClick={onBack} />
				<ToolbarButton
					icon="icon-[mdi--arrow-right]"
					title={labels.forward}
					disabled={!canForward}
					onClick={onForward}
				/>
				{loading ? (
					<ToolbarButton icon="icon-[mdi--close]" title={labels.stop} onClick={onStop} />
				) : (
					<ToolbarButton icon="icon-[mdi--refresh]" title={labels.reload} onClick={onReload} />
				)}
				<form onSubmit={onAddressSubmit} className="min-w-0 flex-1">
					<input
						type="text"
						value={address}
						spellCheck={false}
						placeholder={labels.addressPlaceholder}
						onChange={(e) => onAddressChange(e.target.value)}
						className="h-7 w-full rounded-md border border-transparent bg-transparent px-2.5 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/40 focus:bg-background"
					/>
				</form>
				<ToolbarButton
					icon="icon-[mdi--open-in-new]"
					title={labels.openExternal}
					disabled={!currentUrl}
					onClick={onOpenExternal}
				/>
			</div>

			<div className="relative flex min-h-0 flex-1">
				{/* src 用静态 about:blank 让 guest 立即挂载（dom-ready 才会触发），
				    真实地址由 effect 通过 loadURL 加载；src 不绑 targetUrl 以免页内跳转触发重载。 */}
				<webview
					key={workspaceId}
					ref={webviewRef}
					src="about:blank"
					partition={partition}
					allowpopups={true}
					className="h-full w-full"
				/>
				{!hasPage && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-6 text-center">
						<span className="icon-[mdi--web] h-8 w-8 text-muted-foreground/30" />
						<span className="text-[12px] text-muted-foreground/60">{labels.empty}</span>
					</div>
				)}
				{loading && (
					<div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-background/80 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
						<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
						{labels.loading}
					</div>
				)}
				{failed && (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted p-6 text-center">
						<span className="icon-[mdi--alert-circle-outline] h-8 w-8 text-muted-foreground/40" />
						<span className="text-[12px] text-muted-foreground/70">{labels.failed}</span>
						<button
							type="button"
							onClick={onRetry}
							className="rounded-md border border-border bg-background px-3 py-1 text-[12px] text-foreground transition-colors hover:bg-muted-foreground/10"
						>
							{labels.retry}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
