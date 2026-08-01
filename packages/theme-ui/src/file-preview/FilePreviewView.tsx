import { cn } from "@vetta/ui";
import { useCallback, useState, type JSX, type ReactNode } from "react";
import type { FilePreviewContext, FilePreviewItem } from "./types";

export interface FilePreviewViewLabels {
	showTree: string;
	hideTree: string;
	prev: string;
	next: string;
	download: string;
	refresh: string;
	close: string;
}

export interface FilePreviewViewProps {
	ctx: FilePreviewContext;
	labels: FilePreviewViewLabels;
	onPrev?: () => void;
	onNext?: () => void;
	onClose: () => void;
	canPrev: boolean;
	canNext: boolean;
	onToggleSidebar?: () => void;
	sidebarCollapsed?: boolean;
	onDownload?: (item: FilePreviewItem) => void;
	/** Host builds body; refreshNonce increments on toolbar refresh. */
	renderBody: (item: FilePreviewItem, refreshNonce: number) => ReactNode;
}

/**
 * Inline file preview chrome: header toolbar + body via renderBody.
 * Keyboard shortcuts are owned by the host (ShortcutScopeStack), not this view.
 */
export function FilePreviewView({
	ctx,
	labels,
	onPrev,
	onNext,
	onClose,
	canPrev,
	canNext,
	onToggleSidebar,
	sidebarCollapsed,
	onDownload,
	renderBody,
}: FilePreviewViewProps): JSX.Element | null {
	const total = ctx.items.length;
	const index = ctx.index;
	const item = ctx.items[index] ?? null;
	const [refreshNonce, setRefreshNonce] = useState(0);
	const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

	if (!item) return null;
	const canNavigate = total > 1;

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
			<Header
				item={item}
				labels={labels}
				onClose={onClose}
				onRefresh={refresh}
				onPrev={canNavigate ? onPrev : undefined}
				onNext={canNavigate ? onNext : undefined}
				position={canNavigate ? `${index + 1} / ${total}` : undefined}
				canPrev={canNavigate && canPrev}
				canNext={canNavigate && canNext}
				onToggleSidebar={onToggleSidebar}
				sidebarCollapsed={sidebarCollapsed}
				onDownload={onDownload}
			/>
			{renderBody(item, refreshNonce)}
		</div>
	);
}

function Header({
	item,
	labels,
	onClose,
	onRefresh,
	onPrev,
	onNext,
	position,
	canPrev,
	canNext,
	onToggleSidebar,
	sidebarCollapsed,
	onDownload,
}: {
	item: FilePreviewItem;
	labels: FilePreviewViewLabels;
	onClose: () => void;
	onRefresh: () => void;
	onPrev?: () => void;
	onNext?: () => void;
	position?: string;
	canPrev: boolean;
	canNext: boolean;
	onToggleSidebar?: () => void;
	sidebarCollapsed?: boolean;
	onDownload?: (item: FilePreviewItem) => void;
}): JSX.Element {
	const downloadable = !!item.url;
	return (
		<div className="flex shrink-0 items-center gap-1.5 border-b border-border/40 py-1.5 pl-2 pr-3">
			{onToggleSidebar && (
				<HeaderButton
					icon="icon-[mdi--dock-left]"
					title={sidebarCollapsed ? labels.showTree : labels.hideTree}
					onClick={onToggleSidebar}
				/>
			)}
			<h2 className="-ml-0.5 min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
				{item.name}
			</h2>
			{position && (
				<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{position}</span>
			)}
			{onPrev && (
				<HeaderButton icon="icon-[mdi--chevron-left]" title={labels.prev} onClick={onPrev} disabled={!canPrev} />
			)}
			{onNext && (
				<HeaderButton icon="icon-[mdi--chevron-right]" title={labels.next} onClick={onNext} disabled={!canNext} />
			)}
			{downloadable && onDownload && (
				<HeaderButton icon="icon-[mdi--download]" title={labels.download} onClick={() => onDownload(item)} />
			)}
			<HeaderButton icon="icon-[mdi--refresh]" title={labels.refresh} onClick={onRefresh} />
			<HeaderButton icon="icon-[mdi--close]" title={labels.close} onClick={onClose} />
		</div>
	);
}

function HeaderButton({
	icon,
	title,
	onClick,
	disabled,
}: {
	icon: string;
	title: string;
	onClick: () => void;
	disabled?: boolean;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			disabled={disabled}
			className={cn(
				"flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
				disabled
					? "text-muted-foreground/30"
					: "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
			)}
		>
			<span className={cn(icon, "h-4 w-4")} />
		</button>
	);
}
