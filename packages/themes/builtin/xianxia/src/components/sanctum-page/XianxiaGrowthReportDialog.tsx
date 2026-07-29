import { HorizontalSliceImageFrame, NineSliceImageFrame } from "@vetta/theme-ui";
import {
	cn,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@vetta/ui";
import { motion } from "motion/react";
import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { sanctumPageAssets } from "./assets";
import {
	getGrowthReportView,
	resolveMinPeriodOffset,
	type GrowthReportPeriodMode,
} from "./growthReportView";
import { formatCultivationNumber, getCultivationChartUpperBound } from "./cultivationView";
import type { SanctumCultivationView } from "./types";

// 使用整数 px，避免 rem 在不同 DPR/宽度下变成非整数像素导致 border-image 发丝缝
const reportPanelDecoration = {
	borderWidth: "50px 40px",
	outset: "1px",
	repeat: "stretch",
	slice: "72 64",
} as const;

const reportCardDecoration = {
	borderWidth: "26px 21px",
	outset: "1px",
	repeat: "stretch",
	slice: "54 42",
} as const;

const reportSuggestionDecoration = {
	height: "100%",
	leftSlice: 120,
	leftWidth: "3.75rem",
	repeat: "stretch",
	rightSlice: 160,
	rightWidth: "5rem",
} as const;

const viewTabs = [
	{ label: "月度视图", mode: "month" as const },
	{ label: "周度视图", mode: "week" as const },
] as const;

/** Hard cap for period navigation (~3 months retention). */
const MAX_PERIOD_OFFSET = {
	month: -3,
	week: -12,
} as const;

export function XianxiaGrowthReportDialog({
	children,
	cultivation,
}: {
	readonly children: ReactNode;
	readonly cultivation: SanctumCultivationView;
}): JSX.Element {
	const [periodMode, setPeriodMode] = useState<GrowthReportPeriodMode>("month");
	const [periodOffset, setPeriodOffset] = useState(0);
	const minOffset = useMemo(
		() => Math.max(MAX_PERIOD_OFFSET[periodMode], resolveMinPeriodOffset(cultivation, periodMode)),
		[cultivation, periodMode],
	);
	const safeOffset = Math.max(minOffset, Math.min(0, periodOffset));
	const report = useMemo(
		() => getGrowthReportView(cultivation, { mode: periodMode, offset: safeOffset }),
		[cultivation, periodMode, safeOffset],
	);
	const canGoPrev = safeOffset > minOffset;
	const canGoNext = safeOffset < 0;

	useEffect(() => {
		if (periodOffset !== safeOffset) {
			setPeriodOffset(safeOffset);
		}
	}, [periodOffset, safeOffset]);

	return (
		<Dialog>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent
				className="w-[min(920px,calc(100vw-56px))] max-w-none border-0 bg-transparent p-0 text-slate-700 shadow-none outline-none [display:block] [transform:translate(-50%,-50%)]"
				overlayClassName="bg-transparent backdrop-blur-none supports-backdrop-filter:backdrop-blur-none"
				showCloseButton={false}
			>
				<motion.div
					animate={{ opacity: 1, scale: 1, y: 0 }}
					className="w-full"
					initial={{ opacity: 0, scale: 0.965, y: 12 }}
					transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
				>
					{/*
					 * 布局策略：@container 跟随弹窗内容宽度（非视口）。
					 * 顶栏（标题+工具栏）固定；仅下方报告内容滚动，且隐藏滚动条。
					 */}
					<NineSliceImageFrame
						// 纸色底：弹窗本身透明，border-image 若有 1px 缝会透出深色页面；底色与面板一致可掩缝
						className="xianxia-growth-report-dialog rounded-[18px] bg-[#f3eee4] text-slate-700 drop-shadow-[0_16px_34px_rgba(15,23,42,0.28)]"
						contentClassName="@container relative z-10 flex max-h-[min(860px,calc(100vh-48px))] flex-col overflow-hidden px-4 pb-5 pt-5 @md:px-6 @md:pb-6 @md:pt-6 @3xl:px-8 @3xl:pb-8"
						decoration={reportPanelDecoration}
						imageUrl={sanctumPageAssets.growthReport.panel}
					>
						<div className="flex-none">
							<div className="flex items-center justify-between gap-4 pl-3 @md:pl-5">
								<DialogTitle className="min-w-0 truncate text-[20px] font-semibold leading-7 tracking-[0.08em] text-slate-800 @md:text-[22px]">
									修行履历
								</DialogTitle>
								<DialogDescription className="sr-only">
									展示本月修行成果、历史突破、能力沉淀、徽章和下一步建议。
								</DialogDescription>
								{/* 关闭：非 Dialog 默认按钮，纯叉号（与境界详情面板一致） */}
								<DialogClose asChild>
									<button
										aria-label="关闭修行履历"
										className="flex h-9 w-9 flex-none items-center justify-center text-slate-600 outline-none transition hover:text-[#8a6230] border border-transparent focus-visible:border-[#c7a66f]/75"
										type="button"
									>
										<span aria-hidden="true" className="text-[28px] font-light leading-none">
											×
										</span>
									</button>
								</DialogClose>
							</div>

							{/* 工具栏：左视图切换，右周期导航，两端对齐填满去掉导出后的空位 */}
							<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
								<div className="flex flex-none rounded-full border border-slate-300/65 bg-white/38 p-1 shadow-inner">
									{viewTabs.map((tab) => {
										const active = periodMode === tab.mode;
										return (
											<button
												className={
													active
														? "rounded-full bg-[#273c57] px-4 py-1.5 text-[13px] font-semibold text-amber-50 shadow-[inset_0_1px_4px_rgba(255,255,255,0.28),0_1px_3px_rgba(15,23,42,0.16)] @md:px-7 @md:text-[14px]"
														: "rounded-full px-4 py-1.5 text-[13px] font-semibold text-slate-500 transition hover:text-slate-700 @md:px-7 @md:text-[14px]"
												}
												key={tab.mode}
												onClick={() => {
													setPeriodMode(tab.mode);
													setPeriodOffset(0);
												}}
												type="button"
											>
												{tab.label}
											</button>
										);
									})}
								</div>
								<div className="flex h-10 w-full min-w-[12rem] max-w-[17.5rem] flex-none items-center justify-between rounded-full border border-slate-300/65 bg-white/42 px-3 text-[14px] font-semibold text-slate-600 @md:w-[17.5rem] @md:text-[15px]">
									<button
										aria-label={periodMode === "month" ? "上一月" : "上一周"}
										className="flex h-7 w-7 flex-none items-center justify-center rounded-full outline-none transition hover:bg-slate-900/6 disabled:cursor-not-allowed disabled:opacity-35"
										disabled={!canGoPrev}
										onClick={() => setPeriodOffset((value) => Math.max(minOffset, value - 1))}
										type="button"
									>
										<span className="icon-[solar--alt-arrow-left-linear] h-5 w-5" />
									</button>
									<span className="min-w-0 truncate px-2 text-center">{report.monthLabel}</span>
									<span className="icon-[solar--calendar-linear] h-4 w-4 flex-none opacity-70" />
									<button
										aria-label={periodMode === "month" ? "下一月" : "下一周"}
										className="flex h-7 w-7 flex-none items-center justify-center rounded-full outline-none transition hover:bg-slate-900/6 disabled:cursor-not-allowed disabled:opacity-35"
										disabled={!canGoNext}
										onClick={() => setPeriodOffset((value) => Math.min(0, value + 1))}
										type="button"
									>
										<span className="icon-[solar--alt-arrow-right-linear] h-5 w-5" />
									</button>
								</div>
							</div>
						</div>

						{/* 底部间距由外层 content pb 承担，避免内容贴边框；内部仅保留少量收尾空白 */}
						<div className="xianxia-hidden-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pb-1">
							<ReportCard>
								<SectionTitle
									subtitle={
										report.hasHistoryData
											? `统计周期：${report.periodLabel} · 修为 +${formatCultivationNumber(report.periodScoreDelta)}`
											: `统计周期：${report.periodLabel} · 暂无周期样本`
									}
									title="本月修行成果"
								/>
								{/* 指标：2 → 3 → 6 列阶梯；竖线分隔由 container query 按列数对齐 */}
								<div className="xianxia-growth-report-metrics">
									{report.metrics.map((metric) => (
										<div
											className="xianxia-growth-report-metric flex min-w-0 items-center justify-center gap-2 px-2 @md:px-3"
											key={metric.label}
										>
											<img alt="" className="h-9 w-9 flex-none object-contain @md:h-10 @md:w-10" draggable={false} src={metric.iconUrl} />
											<div className="min-w-0">
												<div className="truncate text-[12px] font-semibold text-slate-600 @md:text-[13px]">{metric.label}</div>
												<div className="mt-0.5 flex items-baseline gap-1">
													<span className="text-[24px] font-semibold leading-none text-slate-800 @md:text-[28px]">{metric.value}</span>
													<span className="text-[12px] text-slate-500">{metric.unit}</span>
												</div>
											</div>
										</div>
									))}
								</div>
							</ReportCard>

							{/* 三卡片：窄=单列堆叠；宽=三等分，避免 2+1 留白不齐 */}
							<div className="mt-4 grid grid-cols-1 gap-3 @3xl:grid-cols-3">
								<ReportCard className="@3xl:min-h-[296px]">
									<SectionTitle subtitle="境界成长时间线" title="历史突破记录" />
									{/* 箭头与徽章同高对齐：箭头落在徽章行高内居中，文案单独在下方 */}
									<div className="flex items-start justify-around gap-1">
										{report.realmTimeline.map((realm, index) => (
											<div className="flex min-w-0 flex-1" key={realm.id}>
												<div className="min-w-0 flex-1 text-center">
													<div className="mx-auto flex h-14 w-14 items-center justify-center @md:h-16 @md:w-16">
														<img alt="" className="h-full w-full object-contain" draggable={false} src={realm.iconUrl} />
													</div>
													<div className="mt-2 truncate text-[14px] font-semibold text-slate-700 @md:text-[15px]">{realm.name}</div>
													<div className="mt-0.5 text-[12px] text-slate-500">{realm.date}</div>
												</div>
												{index < report.realmTimeline.length - 1 && (
													<div className="flex h-14 flex-none items-center @md:h-16">
														<span className="icon-[solar--arrow-right-linear] mx-1 h-5 w-5 text-slate-500/80 @md:mx-2" />
													</div>
												)}
											</div>
										))}
									</div>
									<div className="mt-4">
										<div className="mb-1 flex justify-between text-[12px] text-slate-500">
											<span>修为值成长曲线</span>
											<span>{periodMode === "week" ? "周度区间" : "月度区间"}</span>
										</div>
										{report.hasHistoryData ? (
											<ReportSparkline
												endLabel={report.historyEndLabel}
												points={report.historyPoints}
												startLabel={report.historyStartLabel}
											/>
										) : (
											<div className="flex h-[96px] items-center justify-center rounded-lg border border-dashed border-slate-300/70 bg-white/30 px-3 text-center text-[12px] text-slate-500">
												该周期暂无修为记录（仅保留近约 3 个月的每日分数）
											</div>
										)}
									</div>
								</ReportCard>

								<ReportCard className="@3xl:min-h-[296px]">
									<SectionTitle subtitle="已解锁与沉淀的核心能力" title="能力沉淀" />
									<div className="flex flex-col gap-2.5">
										{report.abilities.map((ability) => (
											<div className="grid grid-cols-[2.35rem_minmax(0,1fr)] items-center gap-2" key={ability.label}>
												<img alt="" className="h-9 w-9 object-contain" draggable={false} src={ability.iconUrl} />
												<div className="min-w-0">
													<div className="flex items-center justify-between gap-2">
														<span className="truncate text-[14px] font-semibold text-slate-700">{ability.label}</span>
														<span className="flex-none text-[13px] font-semibold text-slate-600">Lv.{ability.level}</span>
													</div>
													<div className="mt-1 h-2 rounded-full bg-slate-300/75 p-[1px]">
														<div
															className="h-full rounded-full bg-[#d2ad70]"
															style={{ width: `${ability.progress}%` }}
														/>
													</div>
													<div className="mt-0.5 truncate text-[11px] text-slate-500">{ability.description}</div>
												</div>
											</div>
										))}
									</div>
								</ReportCard>

								<ReportCard className="@3xl:min-h-[296px]">
									<SectionTitle
										action={
											<button className="flex-none text-[12px] font-semibold text-slate-500 hover:text-[#8a6230]" type="button">
												查看全部
												<span className="icon-[solar--alt-arrow-right-linear] ml-1 inline-block h-3.5 w-3.5 align-[-2px]" />
											</button>
										}
										title="已获得称号/徽章"
									/>
									<div className="flex flex-col gap-2.5">
										{report.badges.map((badge) => (
											<div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2" key={badge.title}>
												<img alt="" className="h-11 w-11 object-contain" draggable={false} src={badge.iconUrl} />
												<div className="min-w-0">
													<div className="truncate text-[14px] font-semibold text-slate-700">{badge.title}</div>
													<div className="truncate text-[11px] text-slate-500">{badge.description}</div>
												</div>
												<span className="flex-none text-[11px] text-slate-500">{badge.date}</span>
											</div>
										))}
									</div>
								</ReportCard>
							</div>

							<ReportCard className="mt-4 overflow-hidden" contentClassName="p-0">
								<div className="px-4 pt-4">
									<SectionTitle title="下一步建议" />
								</div>
								<HorizontalSliceImageFrame
									className="m-3 min-h-[104px]"
									contentClassName="relative z-10 grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-4 py-4 @md:px-5"
									decoration={reportSuggestionDecoration}
									imageUrl={sanctumPageAssets.growthReport.suggestion}
								>
									<img alt="" className="mt-1 h-9 w-9 object-contain" draggable={false} src={sanctumPageAssets.cultivationCompositionIcons.power} />
									<div className="min-w-0">
										<div className="text-[14px] font-semibold text-slate-800 @md:text-[15px]">
											建议下一步：{report.nextStepSummary}
										</div>
										<div className="mt-2 grid grid-cols-1 gap-2 @sm:grid-cols-2 @sm:gap-3">
											{report.nextSteps.map((step) => (
												<button
													className="flex min-w-0 items-center gap-2 rounded-[8px] border border-slate-300/70 bg-white/45 px-3 py-2 text-left text-[13px] font-semibold text-slate-700 shadow-inner transition hover:border-[#c7a66f] hover:text-[#8a6230]"
													key={step.label}
													type="button"
												>
													<img alt="" className="h-8 w-8 flex-none object-contain" draggable={false} src={step.iconUrl} />
													<span className="truncate">{step.label}</span>
												</button>
											))}
										</div>
									</div>
								</HorizontalSliceImageFrame>
							</ReportCard>
						</div>
					</NineSliceImageFrame>
				</motion.div>
			</DialogContent>
		</Dialog>
	);
}

function ReportCard({
	children,
	className,
	contentClassName,
}: {
	readonly children: ReactNode;
	readonly className?: string;
	readonly contentClassName?: string;
}): JSX.Element {
	return (
		<NineSliceImageFrame
			className={className}
			contentClassName={cn("relative z-10 p-4", contentClassName)}
			decoration={reportCardDecoration}
			imageUrl={sanctumPageAssets.growthReport.card}
		>
			{children}
		</NineSliceImageFrame>
	);
}

function SectionTitle({
	action,
	subtitle,
	title,
}: {
	readonly action?: ReactNode;
	readonly subtitle?: string;
	readonly title: string;
}): JSX.Element {
	return (
		<div className="mb-3 flex items-baseline justify-between gap-3 border-b border-slate-300/55 pb-2">
			<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
				<h3 className="text-[17px] font-semibold tracking-[0.06em] text-slate-800">{title}</h3>
				{subtitle ? <span className="text-[11px] text-slate-500 @md:text-[12px]">{subtitle}</span> : null}
			</div>
			{action}
		</div>
	);
}

/**
 * Lightweight SVG sparkline (not visx). Left axis shows readable score ticks.
 */
function ReportSparkline({
	endLabel,
	points,
	startLabel,
}: {
	readonly endLabel: string;
	readonly points: readonly number[];
	readonly startLabel: string;
}): JSX.Element {
	const plotWidth = 260;
	const height = 72;
	const left = 36;
	const width = left + plotWidth;
	const safePoints = points.length > 0 ? points : [0];
	const max = getCultivationChartUpperBound(Math.max(...safePoints, 0));
	const min = Math.min(...safePoints, 0);
	const range = Math.max(1, max - min);
	const yAt = (value: number): number => height - ((value - min) / range) * (height - 12) - 6;
	const line = safePoints
		.map((point, index) => {
			const x = left + (index / Math.max(1, safePoints.length - 1)) * plotWidth;
			const y = yAt(point);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
	const lastY = yAt(safePoints[safePoints.length - 1] ?? 0);
	const ticks = [max, (max + min) / 2, min];

	return (
		<svg aria-hidden="true" className="h-[96px] w-full overflow-visible" viewBox={`0 0 ${width} ${height + 18}`}>
			{ticks.map((tick) => {
				const y = yAt(tick);
				return (
					<g key={`tick-${tick}`}>
						<line
							stroke="rgba(71,85,105,0.16)"
							x1={left}
							x2={width}
							y1={y}
							y2={y}
						/>
						<text
							dominantBaseline="middle"
							fill="rgba(71,85,105,0.78)"
							fontSize="10"
							textAnchor="end"
							x={left - 6}
							y={y}
						>
							{formatCultivationNumber(Math.round(tick))}
						</text>
					</g>
				);
			})}
			<polyline
				fill="none"
				points={line}
				stroke="#475569"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
			/>
			<circle cx={width - 1} cy={lastY} fill="#f4e3c4" r="4" stroke="#475569" strokeWidth="1.5" />
			<text fill="rgba(71,85,105,0.72)" fontSize="10" x={left} y={height + 14}>
				{startLabel}
			</text>
			<text fill="rgba(71,85,105,0.72)" fontSize="10" textAnchor="end" x={width} y={height + 14}>
				{endLabel}
			</text>
		</svg>
	);
}
