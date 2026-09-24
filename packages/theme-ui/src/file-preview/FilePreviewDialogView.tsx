import { ThemeSurface } from "../appearance";
import { cn } from "@vetta-org/ui";
import { AnimatePresence, motion } from "motion/react";
import type { JSX, MouseEvent, ReactNode } from "react";
import {
	IMAGE_EXTENSIONS,
	getExtension,
	getPreviewLabel,
	type FilePreviewContext,
	type FilePreviewItem,
} from "./types";

export interface FilePreviewDialogViewLabels {
	readonly close: string;
	readonly download: string;
	readonly showInFolder: string;
}

export interface FilePreviewDialogViewProps {
	readonly context: FilePreviewContext | null;
	readonly isImageGroup: boolean;
	readonly item: FilePreviewItem | null;
	readonly labels: FilePreviewDialogViewLabels;
	readonly onClose: () => void;
	readonly onDownload: (item: FilePreviewItem) => void;
	readonly onGoNext: () => void;
	readonly onGoPrev: () => void;
	readonly onSelectIndex: (index: number) => void;
	readonly onShowInFolder: (path: string) => void;
	/** Host lightbox (resolves image src via IPC). */
	readonly lightbox: ReactNode;
	/** Non-image preview body. */
	readonly previewBody: ReactNode;
	/** Thumbnail strip for image groups. */
	readonly thumbnails?: ReactNode;
}

function isImage(item: FilePreviewItem): boolean {
	return item.kind === "image" || IMAGE_EXTENSIONS.has(getExtension(item.name));
}

/**
 * Full-screen file preview lightbox shell.
 */
export function FilePreviewDialogView({
	context,
	isImageGroup,
	item,
	labels,
	onClose,
	onDownload,
	onGoNext,
	onGoPrev,
	onSelectIndex: _onSelectIndex,
	onShowInFolder,
	lightbox,
	previewBody,
	thumbnails,
}: FilePreviewDialogViewProps): JSX.Element {
	const stop = (e: MouseEvent) => e.stopPropagation();

	return (
		<AnimatePresence>
			{context && item && (
				<motion.div
					// no-drag：盖住下层页面顶部的 -webkit-app-region: drag，否则那块区域的点击会被系统拖窗口接管，浮层按钮点不了
					className="no-drag fixed inset-0 z-50 bg-background/95"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.18, ease: "easeOut" }}
					onClick={onClose}
				>
					<ThemeSurface slot="root.filePreviewDialog" />
					{isImage(item) ? (
						<div className={cn("absolute inset-x-0 top-0", isImageGroup ? "bottom-36" : "bottom-12")}>
							{lightbox}
						</div>
					) : (
						<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-10 pt-16">
							<div
								className="pointer-events-auto relative flex h-full max-h-[85vh] w-full max-w-[80vw] flex-col overflow-visible rounded-xl border border-border bg-background shadow-lg"
								onClick={stop}
							>
								<ThemeSurface slot="root.filePreviewDialog.panel" />
								<div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
									<div className="flex shrink-0 items-center border-b border-border/50 px-4 py-2.5">
										<span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
											{getPreviewLabel(item)}
										</span>
									</div>
									<div className="flex min-h-0 flex-1 flex-col">{previewBody}</div>
								</div>
							</div>
						</div>
					)}

					<div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-end gap-2 bg-gradient-to-b from-background/80 to-transparent px-3 pb-8 pt-12">
						{isImageGroup && (
							<span className="mr-1 shrink-0 text-[12px] tabular-nums text-muted-foreground">
								{context.index + 1} / {context.items.length}
							</span>
						)}
						{item.path && (
							<OverlayButton
								icon="icon-[mdi--folder-open-outline]"
								title={labels.showInFolder}
								onClick={() => onShowInFolder(item.path as string)}
							/>
						)}
						{item.url && (
							<OverlayButton
								icon="icon-[mdi--download]"
								title={labels.download}
								onClick={() => onDownload(item)}
							/>
						)}
						<OverlayButton icon="icon-[mdi--close]" title={labels.close} onClick={onClose} />
					</div>

					{isImageGroup && (
						<>
							<OverlayArrow
								side="left"
								disabled={context.index <= 0}
								onClick={(e) => {
									stop(e);
									onGoPrev();
								}}
							/>
							<OverlayArrow
								side="right"
								disabled={context.index >= context.items.length - 1}
								onClick={(e) => {
									stop(e);
									onGoNext();
								}}
							/>
						</>
					)}

					{isImage(item) && (
						<div
							className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-4"
							onClick={stop}
						>
							{isImageGroup && thumbnails}
							<span className="max-w-[80vw] truncate text-[12px] text-muted-foreground">
								{getPreviewLabel(item)}
							</span>
						</div>
					)}
				</motion.div>
			)}
		</AnimatePresence>
	);
}

export function OverlayButton({
	icon,
	title,
	onClick,
}: {
	icon: string;
	title: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			title={title}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			className="pointer-events-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
		>
			<span className={cn(icon, "h-5 w-5")} />
		</button>
	);
}

export function OverlayArrow({
	side,
	disabled,
	onClick,
}: {
	side: "left" | "right";
	disabled: boolean;
	onClick: (e: MouseEvent) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
				side === "left" ? "left-4" : "right-4",
				disabled ? "text-muted-foreground/30" : "bg-accent/50 text-foreground hover:bg-accent",
			)}
		>
			<span
				className={cn(side === "left" ? "icon-[mdi--chevron-left]" : "icon-[mdi--chevron-right]", "h-6 w-6")}
			/>
		</button>
	);
}

export function ThumbnailView({
	src,
	error,
	name,
	active,
	onClick,
}: {
	src: string;
	error: boolean;
	name: string;
	active: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"h-16 w-16 shrink-0 overflow-hidden rounded-md transition-opacity",
				active ? "ring-1 ring-inset ring-border" : "opacity-60 hover:opacity-100",
			)}
		>
			{error || !src ? (
				<div className="flex h-full w-full items-center justify-center bg-muted">
					<span className="icon-[mdi--image-outline] h-5 w-5 text-muted-foreground" />
				</div>
			) : (
				<img src={src} alt={name} draggable={false} className="h-full w-full object-cover" />
			)}
		</button>
	);
}
