import { useTranslation } from "@vetta-org/plugin-sdk";
import { useRef, useState } from "react";
import { ColumnsPopover } from "./ColumnsPopover";
import type { SnapRect } from "./snap";

interface ArrangeToolbarProps {
	/** 选区包围盒（世界坐标），工具条贴在它的右下角外侧。 */
	bounds: SnapRect;
	/** 当前生效的列数，宫格浮层用它点亮格子。 */
	columns: number;
	/** 选中的 frame 数量，列数输入的上限。 */
	count: number;
	onTidy(): void;
	onColumns(columns: number): void;
}

const icons = {
	tidy: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="3" width="7" height="7" rx="1.5" />
			<rect x="14" y="3" width="7" height="7" rx="1.5" />
			<rect x="3" y="14" width="7" height="7" rx="1.5" />
			<rect x="14" y="14" width="7" height="7" rx="1.5" />
		</svg>
	),
	grid: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
		</svg>
	),
};

/**
 * 多选时浮在选区右下角的整理工具条：一键排列 + 列数。
 *
 * 挂在 world 层里（跟着画布走），但按 `--vetd-lscale` 反向缩放，任何缩放下都是同样
 * 大小的一颗按钮——和 frame 标题栏用的是同一套办法。
 */
export function ArrangeToolbar({ bounds, columns, count, onTidy, onColumns }: ArrangeToolbarProps) {
	const { t } = useTranslation();
	const [pickerOpen, setPickerOpen] = useState(false);
	const barRef = useRef<HTMLDivElement | null>(null);
	const scale = "var(--vetd-lscale, 1)";

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: canvas overlay swallowing canvas gestures
		<div
			className="absolute z-30"
			style={{
				left: bounds.x + bounds.width,
				top: bounds.y + bounds.height,
				transform: `scale(${scale})`,
				transformOrigin: "right top",
				marginTop: `calc(8px * ${scale})`,
			}}
			// 不拦的话按下就被画布判成「在空白处起手框选」，选中当场没了。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			<div
				ref={barRef}
				className="absolute right-0 top-0 flex items-center gap-0.5 rounded-xl border border-border bg-card/95 px-1 py-1 shadow-lg"
			>
				<button
					type="button"
					title={t("canvas.arrange.tidy")}
					aria-label={t("canvas.arrange.tidy")}
					onClick={onTidy}
					className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					{icons.tidy}
				</button>
				<button
					type="button"
					title={t("canvas.arrange.columns")}
					aria-label={t("canvas.arrange.columns")}
					aria-expanded={pickerOpen}
					onClick={() => setPickerOpen((open) => !open)}
					className={`flex size-7 items-center justify-center rounded-lg transition-colors ${
						pickerOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
					}`}
				>
					{icons.grid}
				</button>
				{pickerOpen ? (
					<ColumnsPopover
						current={columns}
						max={count}
						boundaryRef={barRef}
						onPick={(next) => {
							setPickerOpen(false);
							onColumns(next);
						}}
						onClose={() => setPickerOpen(false)}
					/>
				) : null}
			</div>
		</div>
	);
}
