import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DESIGN_SYSTEMS, designSystemById } from "../design-systems/index";
import { DesignSystemTileContent } from "./DesignSystemTileContent";

interface TemplateGalleryDialogProps {
	onApply(systemId: string, name: string): void;
	onClose(): void;
	/** 已应用的体系：宫格里打「当前」徽标，副标题换成「当前：X」。会话卡片不传。 */
	appliedId?: string | null;
	/** 应用执行中：底部按钮转圈并锁住。 */
	busy?: boolean;
	/** 标题栏右侧插槽（画布入口的「还原备份」）。 */
	headerActions?: ReactNode;
	/** 上面压着二次确认框时让出 Esc，否则一次按键把两层一起关掉。 */
	escDisabled?: boolean;
}

/**
 * 全量设计体系选择 Dialog。两个入口共用：会话宫格的「更多」，以及画布工具栏的
 * 设计资源按钮。点卡只是选中、点底部「应用」才执行——与会话宫格「点击即发送」
 * 相反，这里刻意加一道确认，避免在长列表里手滑误发。
 */
export function TemplateGalleryDialog({
	onApply,
	onClose,
	appliedId,
	busy,
	headerActions,
	escDisabled,
}: TemplateGalleryDialogProps) {
	const { t } = useTranslation();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = selectedId ? designSystemById(selectedId) : undefined;
	const applied = appliedId ? designSystemById(appliedId) : undefined;

	// Esc 关闭。捕获阶段拦下，别让宿主把它当别的快捷键消费。
	useEffect(() => {
		if (escDisabled) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onClose, escDisabled]);

	// portal 到 body 逃出消息列表：卡片子树里 InputBar 是后绘制的兄弟层级，
	// 任何 z-index 都压不过它。插件 CSS 以 [data-vetta-plugin-root] 为 @scope 根，
	// 蒙层自带该属性重新进入作用域（@scope 根自身也在作用域内），Tailwind 类才生效。
	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
		<div
			data-vetta-plugin-root="vetta-ui-design"
			className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 px-6 py-8 backdrop-blur-[2px]"
			onClick={onClose}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: keeps backdrop clicks off the panel */}
			<div
				role="dialog"
				aria-label={t("ds.title")}
				className="flex max-h-[min(72vh,680px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex shrink-0 items-center gap-3 border-b border-border px-5 pb-3 pt-4">
					<div className="min-w-0">
						<div className="text-sm font-semibold text-foreground">{t("ds.title")}</div>
						<div className="truncate text-xs text-muted-foreground">
							{applied ? t("ds.applied.current", { name: applied.name }) : t("ds.subtitle")}
						</div>
					</div>
					<div className="flex-1" />
					{headerActions}
					<button
						type="button"
						title={t("ds.close")}
						aria-label={t("ds.close")}
						onClick={onClose}
						className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
						</svg>
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					<div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
						{DESIGN_SYSTEMS.map((system) => {
							const isSelected = selectedId === system.id;
							return (
								<button
									key={system.id}
									type="button"
									onClick={() => setSelectedId(isSelected ? null : system.id)}
									className={`flex aspect-square min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border p-2 text-left transition-all duration-200 ${
										isSelected
											? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
											: "border-border hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:bg-accent/40 hover:shadow-md"
									}`}
								>
									<DesignSystemTileContent
										system={system}
										badge={
											appliedId === system.id ? (
												<span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
													{t("ds.applied.badge")}
												</span>
											) : undefined
										}
									/>
								</button>
							);
						})}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
					<div className="min-w-0 truncate text-xs text-muted-foreground">
						{selected ? t(`ds.tagline.${selected.id}`) : t("ds.dialog.pickHint")}
					</div>
					<div className="flex-1" />
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						{t("ds.confirm.cancel")}
					</button>
					<button
						type="button"
						disabled={!selected || busy}
						onClick={() => selected && onApply(selected.id, selected.name)}
						className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
					>
						{busy ? (
							<span className="size-3 animate-spin rounded-full border-[1.5px] border-primary-foreground/40 border-t-primary-foreground" />
						) : null}
						{selected ? t("ds.apply.named", { name: selected.name }) : t("ds.apply")}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
