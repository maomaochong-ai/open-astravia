import { AnimatePresence, motion } from "motion/react";
import { type JSX, type RefObject, useEffect, useState } from "react";
import { cn } from "@astravia-org/ui/utils";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { ReleaseNoteMarkdown } from "./ReleaseNoteMarkdown";

/**
 * 更新对话框的底部状态条：检查中 / 下载进度 / 出错。
 * 其余阶段（有新版本、已就绪、已是最新、版本介绍）不需要状态条，直接展示正文。
 */
export type UpdateRestartDialogStatus =
	| { readonly kind: "checking"; readonly text: string }
	| { readonly kind: "progress"; readonly text: string; readonly progress: number }
	| { readonly kind: "error"; readonly text: string };

export interface UpdateRestartDialogAction {
	readonly disabled?: boolean;
	readonly label: string;
	readonly onClick: () => void;
}

export interface UpdateRestartDialogViewProps {
	/** 顶部横幅图；省略时不渲染横幅（无图主题或精简外壳）。 */
	readonly bannerSrc?: string;
	/** 无正文时的占位文案（如「暂无版本介绍」）；有 releaseNote 时不显示。 */
	readonly emptyText?: string;
	readonly closeLabel: string;
	readonly onClose: () => void;
	/**
	 * 「查看更多」：正文是完整发布说明时，这条按钮把它交给文件预览读全文。
	 *
	 * 对话框里的说明按卡片高度裁切，长版本（几十条改动）到此为止；没有这条入口，
	 * 用户就只能看到前面几条，和设置页卡片的行为也对不上。
	 */
	readonly onViewMore?: () => void;
	readonly overlayRef: RefObject<HTMLDivElement | null>;
	/** 底部唯一的悬浮按钮；省略时不显示底栏，只能用右上角的关闭按钮离开。 */
	readonly primary?: UpdateRestartDialogAction;
	readonly releaseNote?: string;
	readonly status?: UpdateRestartDialogStatus;
	readonly subtitle?: string;
	readonly title: string;
	readonly visible: boolean;
	/** 「查看更多」的文案；缺省时按「查看更多」渲染。 */
	readonly viewMoreLabel?: string;
	/** 正文正在加载（版本介绍从磁盘读取时）。 */
	readonly loading?: boolean;
}

// 底部主按钮：通栏胶囊，悬浮在正文之上。
const pillClass =
	"pointer-events-auto inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-[14px] font-medium whitespace-nowrap text-primary-foreground shadow-lg shadow-black/15 transition-all outline-none select-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

export function UpdateRestartDialogView({
	bannerSrc,
	closeLabel,
	emptyText,
	loading = false,
	onClose,
	onViewMore,
	overlayRef,
	primary,
	releaseNote,
	status,
	subtitle,
	title,
	viewMoreLabel,
	visible,
}: UpdateRestartDialogViewProps): JSX.Element {
	// 滚动后才显示顶部渐隐，初始位置横幅完整露出。
	const [scrolled, setScrolled] = useState(false);
	// 关闭后再打开，滚动位置回到顶部，渐隐也要复位。
	useEffect(() => {
		if (!visible) setScrolled(false);
	}, [visible]);
	const showEmpty = !loading && !releaseNote && !!emptyText;

	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					ref={overlayRef}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.15 }}
					className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70"
					onClick={(e) => {
						if (e.target === overlayRef.current) onClose();
					}}
				>
					<motion.div
						role="dialog"
						aria-modal="true"
						aria-label={title}
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
						className="relative flex max-h-[min(720px,calc(100vh-48px))] w-[min(600px,calc(100vw-32px))] flex-col overflow-hidden rounded-3xl bg-popover shadow-2xl"
					>
						<ThemeSurface slot="root.updateRestartDialog.panel" />
						<div className="relative z-10 flex min-h-0 flex-1 flex-col">
							<button
								type="button"
								onClick={onClose}
								aria-label={closeLabel}
								// 纯白圆形：深浅色下都不随主题变色，靠双层投影从横幅和正文上浮起来。
								className="absolute top-4 right-4 z-20 inline-flex size-8 items-center justify-center rounded-full bg-white text-neutral-900 shadow-[0_6px_18px_rgba(0,0,0,0.28),0_1px_3px_rgba(0,0,0,0.22)] transition-transform outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95"
							>
								<span className="icon-[mdi--close] h-4 w-4" />
							</button>
							<div className="relative flex min-h-0 flex-1 flex-col">
								<div
									// no-scrollbar：全局 overlay 滚动条规则无 layer，Tailwind 的隐藏写法压不过它。
									className="no-scrollbar min-h-0 flex-1 overflow-y-auto"
									onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
								>
									{bannerSrc ? (
										<img
											src={bannerSrc}
											alt=""
											draggable={false}
											className="h-[176px] w-full object-cover select-none"
										/>
									) : null}
									<div className={cn("px-7 pt-6", primary ? "pb-32" : "pb-12")}>
										<h3 className="text-[19px] leading-snug font-semibold tracking-tight text-foreground">
											{title}
										</h3>
										{subtitle && (
											<p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
										)}
										{status && <StatusLine status={status} />}
										{releaseNote && (
											<div className="mt-5">
												<div className="markdown-body text-[13px] leading-[1.6] break-words text-muted-foreground">
													<ReleaseNoteMarkdown>{releaseNote}</ReleaseNoteMarkdown>
												</div>
												{onViewMore && (
													<div className="mt-2 flex justify-start">
														<button
															type="button"
															onClick={onViewMore}
															className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-muted/50 hover:underline"
														>
															<span>{viewMoreLabel ?? "View more"}</span>
															<span className="icon-[mdi--chevron-right] h-3.5 w-3.5" />
														</button>
													</div>
												)}
											</div>
										)}
										{loading && (
											<div className="mt-5 flex items-center gap-2 text-[13px] text-muted-foreground">
												<span className="icon-[mdi--loading] h-4 w-4 animate-spin" />
											</div>
										)}
										{showEmpty && <p className="mt-5 text-[13px] text-muted-foreground">{emptyText}</p>}
									</div>
								</div>
								<div
									aria-hidden
									className={cn(
										"pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-popover to-transparent transition-opacity duration-150",
										scrolled ? "opacity-100" : "opacity-0",
									)}
								/>
								{/* 底部渐隐常驻：有按钮时更厚（按钮下方一段是实色），没按钮时只是一道薄薄的收边。 */}
								<div
									className={cn(
										"pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-popover",
										primary
											? "via-popover/90 from-[55%] to-transparent px-7 pt-20 pb-7"
											: "h-10 to-transparent",
									)}
								>
									{primary && (
										<button
											type="button"
											onClick={primary.onClick}
											disabled={primary.disabled}
											className={pillClass}
										>
											{primary.label}
										</button>
									)}
								</div>
							</div>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

function StatusLine({ status }: { readonly status: UpdateRestartDialogStatus }): JSX.Element {
	if (status.kind === "progress") {
		const percent = Math.max(0, Math.min(100, Math.round(status.progress * 100)));
		return (
			<div className="mt-4">
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-primary transition-[width] duration-300"
						style={{ width: `${percent}%` }}
					/>
				</div>
				<p className="mt-2 text-[12px] text-muted-foreground">{status.text}</p>
			</div>
		);
	}
	if (status.kind === "checking") {
		return (
			<p className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
				<span className="icon-[mdi--loading] h-4 w-4 animate-spin" />
				{status.text}
			</p>
		);
	}
	return <p className="mt-4 text-[13px] break-words text-destructive">{status.text}</p>;
}
