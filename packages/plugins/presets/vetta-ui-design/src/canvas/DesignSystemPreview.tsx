import { useMemo } from "react";
import { parsePreviewTokens, tint } from "../design-systems/preview-tokens";
import type { DesignSystem } from "../design-systems/types";

/**
 * 一张通用产品界面缩略图：顶栏 + 侧栏 + 统计卡 + 主按钮 + 列表行。
 * 所有颜色/圆角/阴影都取自该体系的 theme.css（单一真源），Tailwind 只负责布局
 * ——动态值走 inline style，JIT 扫不到运行期字符串。
 * className 可覆盖尺寸（默认 164px 定高，宫格里传 aspect 比例自适应列宽）。
 */
export function DesignSystemPreview({ system, className }: { system: DesignSystem; className?: string }) {
	const tokens = useMemo(() => parsePreviewTokens(system.themeCss), [system.themeCss]);
	const { colors, radius, shadow } = tokens;
	const fg = colors["surface-foreground"];
	const raised = colors["surface-raised"] ?? colors.surface;
	const border = colors.border ?? tint(colors.muted, 30);
	/** 预览是 ~240px 的缩略图，radius 原值会失真地大，按一半呈现质感差异。 */
	const r = (name: string, fallback: string): string => {
		const raw = radius[name];
		const value = raw ? Number.parseFloat(raw) : Number.NaN;
		return Number.isFinite(value) ? `${Math.round(value / 2)}px` : fallback;
	};

	return (
		<div
			className={`pointer-events-none flex w-full select-none flex-col overflow-hidden border ${className ?? "h-[164px]"}`}
			style={{ background: colors.surface, borderColor: border, borderRadius: r("xl", "8px") }}
		>
			{/* 顶栏：窗口点 + 搜索框 */}
			<div
				className="flex h-7 shrink-0 items-center gap-1.5 border-b px-2"
				style={{ background: raised, borderColor: border }}
			>
				<span className="size-1.5 rounded-full" style={{ background: tint(colors.muted, 45) }} />
				<span className="size-1.5 rounded-full" style={{ background: tint(colors.muted, 45) }} />
				<div
					className="ml-1 h-3.5 flex-1 border"
					style={{ background: colors.surface, borderColor: border, borderRadius: r("md", "3px") }}
				/>
			</div>
			<div className="flex min-h-0 flex-1">
				{/* 侧栏：一条激活项 + 两条普通项 */}
				<div
					className="flex w-11 shrink-0 flex-col gap-1 border-r p-1.5"
					style={{ background: raised, borderColor: border }}
				>
					<div
						className="flex h-3 items-center gap-0.5 px-0.5"
						style={{ background: tint(colors.primary, 18), borderRadius: r("sm", "2px") }}
					>
						<span className="size-1 rounded-full" style={{ background: colors.primary }} />
					</div>
					<div className="h-3" style={{ background: tint(colors.muted, 18), borderRadius: r("sm", "2px") }} />
					<div className="h-3" style={{ background: tint(colors.muted, 18), borderRadius: r("sm", "2px") }} />
				</div>
				{/* 主区：标题 + 主按钮 → 统计卡 ×2 → 列表行 ×3 */}
				<div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-bold leading-none" style={{ color: fg }}>
							Aa
						</span>
						<div
							className="flex h-4 w-9 items-center justify-center"
							style={{ background: colors.primary, borderRadius: r("lg", "4px"), boxShadow: shadow.sm }}
						>
							<span
								className="h-1 w-4 rounded-full"
								style={{ background: colors["primary-foreground"] ?? "#fff" }}
							/>
						</div>
					</div>
					<div className="flex gap-1.5">
						{[colors.primary, colors.accent].map((bar, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: 两张静态占位卡
								key={index}
								className="flex-1 border p-1"
								style={{
									background: raised,
									borderColor: border,
									borderRadius: r("lg", "4px"),
									boxShadow: shadow.sm,
								}}
							>
								<div
									className="mb-1 h-1 w-6 rounded-full"
									style={{ background: tint(colors.muted, 45) }}
								/>
								<div className="h-1.5 w-9 rounded-full" style={{ background: bar }} />
							</div>
						))}
					</div>
					<div className="flex min-h-0 flex-1 flex-col justify-end gap-1">
						{[colors.accent, colors.primary, colors.danger].map((dot, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 三条静态占位行
							<div key={index} className="flex items-center gap-1">
								<span className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} />
								<span
									className="h-1 flex-1 rounded-full"
									style={{ background: tint(colors.muted, 28) }}
								/>
								<span
									className="h-1 w-5 shrink-0 rounded-full"
									style={{ background: tint(colors.muted, 16) }}
								/>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
