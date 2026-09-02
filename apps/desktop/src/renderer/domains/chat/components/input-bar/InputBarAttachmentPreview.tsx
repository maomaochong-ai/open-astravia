import type { AppshotAttachment } from "@shared/store/atoms";
import { AppshotCard } from "../AppshotCard";

export interface InputBarAttachmentPreviewProps {
	readonly open: boolean;
	readonly renderContent: boolean;
	readonly className?: string;
	readonly pendingMessageEdit: boolean;
	readonly pendingEditHint: string;
	readonly cancelPendingEditLabel: string;
	readonly appshotAttachment: AppshotAttachment | null;
	readonly images: ReadonlyArray<{
		readonly path: string;
		readonly name: string;
		readonly url: string;
		readonly label: string;
	}>;
	readonly removeImageLabel: string;
	readonly onCancelPendingEdit: () => void;
	readonly onRemoveAppshot: () => void;
	readonly onOpenImagePreview: (index: number) => void;
	readonly onRemoveImage: (path: string) => void;
}

/** Non-inline attachment previews rendered above the editor. */
export function InputBarAttachmentPreview({
	open,
	renderContent,
	className,
	pendingMessageEdit,
	pendingEditHint,
	cancelPendingEditLabel,
	appshotAttachment,
	images,
	removeImageLabel,
	onCancelPendingEdit,
	onRemoveAppshot,
	onOpenImagePreview,
	onRemoveImage,
}: InputBarAttachmentPreviewProps): JSX.Element {
	return (
		<div
			aria-hidden={!open}
			className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
			style={{
				gridTemplateRows: open ? "1fr" : "0fr",
				opacity: open ? 1 : 0,
			}}
		>
			<div className="min-h-0 overflow-hidden rounded-t-[inherit]">
				{renderContent ? (
					<div className={["space-y-1.5 px-3 pt-3", className].filter(Boolean).join(" ")}>
						{pendingMessageEdit ? (
							<div className="flex items-center justify-between gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary">
								<span className="min-w-0 flex-1 leading-snug">{pendingEditHint}</span>
								<button
									type="button"
									onClick={onCancelPendingEdit}
									className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
								>
									{cancelPendingEditLabel}
								</button>
							</div>
						) : null}

						{appshotAttachment ? (
							<AppshotCard data={appshotAttachment} onRemove={onRemoveAppshot} />
						) : null}

						{/* 图片缩略图行：文本流里对应「图 N」胶囊，编号在角标上复现 */}
						{images.length > 0 ? (
							<div className="flex flex-wrap items-center gap-1.5">
								{images.map((image, index) => (
									<div key={image.path} className="group relative">
										<button
											type="button"
											onClick={() => onOpenImagePreview(index)}
											className="block h-12 w-12 overflow-hidden rounded-lg border border-border ring-1 ring-border/40"
											title={image.name}
										>
											<img
												src={image.url}
												alt={image.name}
												className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
											/>
										</button>
										<span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-foreground/45 px-1 text-[9px] font-medium leading-[1.4] text-background/90">
											{image.label}
										</span>
										<button
											type="button"
											onClick={() => onRemoveImage(image.path)}
											className="absolute -right-1.5 -top-1.5 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 hover:text-destructive"
											title={removeImageLabel}
											style={{ height: 18, width: 18 }}
										>
											<span className="icon-[solar--close-circle-linear] h-3 w-3" />
										</button>
									</div>
								))}
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
