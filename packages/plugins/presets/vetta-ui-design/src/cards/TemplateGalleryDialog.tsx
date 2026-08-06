import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DESIGN_SYSTEMS, designSystemById } from "../design-systems/index";
import { DesignSystemTileContent } from "./DesignSystemTileContent";

/**
 * 全局模板选择 Dialog（会话宫格「更多」入口）：全量体系宫格，点卡只是选中、
 * 点底部「应用」才把选择发出去——与宫格「点击即发送」相反，这里刻意加一道
 * 确认，避免在长列表里手滑误发。样式对齐画布里的设计资源 drawer。
 */
export function TemplateGalleryDialog({
	onApply,
	onClose,
}: {
	onApply(systemId: string, name: string): void;
	onClose(): void;
}) {
	const { t } = useTranslation();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected = selectedId ? designSystemById(selectedId) : undefined;

	// Esc 关闭。捕获阶段拦下，别让宿主把它当别的快捷键消费。
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onClose]);

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
						<div className="truncate text-xs text-muted-foreground">{t("ds.subtitle")}</div>
					</div>
					<div className="flex-1" />
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
									<DesignSystemTileContent system={system} />
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
						disabled={!selected}
						onClick={() => selected && onApply(selected.id, selected.name)}
						className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
					>
						{selected ? t("ds.apply.named", { name: selected.name }) : t("ds.apply")}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
