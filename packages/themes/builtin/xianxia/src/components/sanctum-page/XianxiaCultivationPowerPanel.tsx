import { NineSliceImageFrame } from "@vetta/theme-ui";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { motion } from "motion/react";
import { useMemo, useState, type JSX } from "react";
import { sanctumPageAssets } from "./assets";
import {
	getCultivationCompositionItems,
	type CultivationPanelView,
} from "./cultivationComposition";
import { cultivationPowerPanelDecoration, PANEL_WIDTH_CLASS } from "./cultivationPanelChrome";
import { formatCultivationNumber } from "./cultivationView";
import type { SanctumCultivationView } from "./types";
import { XianxiaCultivationCompositionPopover } from "./XianxiaCultivationCompositionPopover";
import { XianxiaCultivationNumber } from "./XianxiaCultivationNumber";
import { XianxiaCultivationTrendChart } from "./XianxiaCultivationTrendChart";

/**
 * Sanctum cultivation power summary card.
 * Owns open-state for the composition/rules popover only.
 */
export function XianxiaCultivationPowerPanel({
	cultivation,
}: {
	readonly cultivation: SanctumCultivationView;
}): JSX.Element {
	const [compositionOpen, setCompositionOpen] = useState(false);
	const [compositionMounted, setCompositionMounted] = useState(false);
	const [panelView, setPanelView] = useState<CultivationPanelView>("composition");
	/** 1 = forward (composition → rules), -1 = back (rules → composition). */
	const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
	const compositionItems = useMemo(() => getCultivationCompositionItems(cultivation), [cultivation]);
	const showTrendChart = cultivation.trend.length > 1;

	const openPanel = (view: CultivationPanelView): void => {
		setSlideDirection(view === "rules" ? 1 : -1);
		setPanelView(view);
		setCompositionMounted(true);
		setCompositionOpen(true);
	};

	const handleCompositionOpenChange = (open: boolean): void => {
		if (open) {
			openPanel("composition");
			return;
		}
		setCompositionOpen(false);
	};

	const goToRules = (): void => {
		setSlideDirection(1);
		setPanelView("rules");
	};

	const goToComposition = (): void => {
		setSlideDirection(-1);
		setPanelView("composition");
	};

	return (
		<NineSliceImageFrame
			className="w-full min-w-0 overflow-visible text-white drop-shadow-[0_0_10px_rgba(255,246,210,0.5)]"
			contentClassName="relative z-10 grid min-w-0 grid-cols-[minmax(0,1fr)_9.4rem] gap-4 px-[31px] py-[17px] min-[1280px]:grid-cols-[minmax(0,1fr)_9.8rem] min-[1280px]:gap-6"
			decoration={cultivationPowerPanelDecoration}
			imageUrl={sanctumPageAssets.cultivationPowerPanel}
		>
			<div className="flex min-w-0 flex-col">
				<div
					className={cn(
						"grid min-w-0 gap-4 min-[1280px]:gap-5",
						showTrendChart
							? "grid-cols-[minmax(0,1fr)_9.5rem] min-[1280px]:grid-cols-[minmax(0,1fr)_10rem]"
							: "grid-cols-1",
					)}
				>
					<div className="min-w-0">
						<div className="flex items-center gap-3">
							<span className="text-[18px] text-amber-100 drop-shadow-[0_0_5px_rgba(255,245,205,0.8)]">✧</span>
							<h2 className="text-[22px] font-semibold leading-7 text-amber-50 drop-shadow-[0_1px_3px_rgba(15,23,42,0.65)] min-[1280px]:text-[24px] min-[1280px]:leading-8">
								修为值
							</h2>
							<span className="text-[16px] text-slate-200/90 min-[1280px]:text-[18px]">Cultivation Power</span>
							<button
								aria-label="了解修为规则"
								className="flex h-5 w-5 flex-none items-center justify-center text-slate-200/75 outline-none transition hover:text-amber-50 border border-transparent focus-visible:border-amber-200/80"
								data-xianxia-cultivation-rules-trigger=""
								onClick={() => openPanel("rules")}
								type="button"
							>
								<span className="icon-[solar--info-circle-linear] h-5 w-5" />
							</button>
						</div>
						<div className="ml-4 min-[1280px]:ml-6">
							<div className="mt-4 flex min-w-0 items-end gap-3">
								<XianxiaCultivationNumber
									className="drop-shadow-[0_1px_4px_rgba(15,23,42,0.75)]"
									digitClassName="h-[48px] min-[1280px]:h-[58px]"
									value={cultivation.currentPower}
								/>
								<span className="pb-1.5 text-[25px] font-semibold leading-none text-slate-100/95 min-[1280px]:pb-2 min-[1280px]:text-[30px]">/ {formatCultivationNumber(cultivation.maxPower)}</span>
							</div>
							<div className="mt-2 h-3 w-[82%] shrink-0 overflow-hidden rounded-full border border-[#edd2aa]/55 bg-slate-950/35 p-[2px] shadow-inner">
								<motion.div
									animate={{ width: cultivation.progressPercent }}
									className="h-full rounded-full bg-[#edd2aa] shadow-[0_0_5px_rgba(237,210,170,0.58)]"
									initial={{ width: "0%" }}
									transition={{ delay: 0.38, duration: 0.75, ease: "easeOut" }}
								/>
							</div>
							<p className="mt-2 text-[13px] font-semibold tracking-[0.08em] text-slate-200/70">
								数据来自真实使用行为
							</p>
						</div>
					</div>
					{showTrendChart && (
						<div className="mt-[24px] flex min-w-0 justify-end">
							<XianxiaCultivationTrendChart cultivation={cultivation} />
						</div>
					)}
				</div>
				<div className="relative mt-2 grid min-h-[4.65rem] shrink-0 grid-cols-[1.1fr_repeat(3,1fr)] overflow-visible rounded-[10px] border border-white/18 bg-slate-900/18">
					<div className="flex min-w-0 flex-col items-start px-3 pt-3 min-[1280px]:px-4">
						<div className="text-[15px] font-semibold tracking-[0.08em] text-slate-200/90 min-[1280px]:text-[17px]">
							最近增长
						</div>
						<div className="relative mt-1">
							<Popover open={compositionMounted} onOpenChange={handleCompositionOpenChange}>
								<PopoverTrigger asChild>
									<button
										className="inline-flex items-center gap-1 text-[12px] font-semibold leading-4 text-[#edd2aa] outline-none transition hover:text-amber-50 border border-transparent focus-visible:border-amber-200/80"
										type="button"
									>
										<span>修为构成</span>
										<span className="icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5" />
									</button>
								</PopoverTrigger>
								{compositionMounted && (
									<PopoverContent
										align="start"
										className={cn(
											"z-[100] border-0 bg-transparent p-0 text-slate-700 shadow-none outline-none",
											PANEL_WIDTH_CLASS,
										)}
										onOpenAutoFocus={(event) => event.preventDefault()}
										onPointerDownOutside={(event) => {
											const target = event.target;
											if (!(target instanceof Element)) return;
											// Title info button also opens this panel; keep it from dismissing.
											if (target.closest("[data-xianxia-cultivation-rules-trigger]")) {
												event.preventDefault();
											}
										}}
										side="bottom"
										sideOffset={8}
									>
										<XianxiaCultivationCompositionPopover
											currentPower={cultivation.currentPower}
											direction={slideDirection}
											items={compositionItems}
											maxPower={cultivation.maxPower}
											onBackToComposition={goToComposition}
											onExitComplete={() => {
												if (!compositionOpen) {
													setCompositionMounted(false);
													setPanelView("composition");
													setSlideDirection(1);
												}
											}}
											onOpenRules={goToRules}
											open={compositionOpen}
											scoreBreakdown={cultivation.scoreBreakdown}
											view={panelView}
										/>
									</PopoverContent>
								)}
							</Popover>
						</div>
					</div>
					{cultivation.growth.map((item, index) => (
						<div
							className="relative flex min-w-0 flex-col items-center justify-center px-2 py-1.5 text-center"
							key={item.label}
						>
							{index > 0 && <span className="absolute bottom-3 left-0 top-3 w-px bg-white/16" />}
							<div className="truncate text-[13px] leading-5 text-slate-200/85">{item.label}</div>
							<XianxiaCultivationNumber
								className="mt-0.5 drop-shadow-[0_1px_3px_rgba(15,23,42,0.62)]"
								digitClassName="h-[24px] min-[1280px]:h-[28px]"
								prefix="+"
								value={item.value}
							/>
						</div>
					))}
				</div>
			</div>
			<div className="mt-[24px] flex h-fit flex-col rounded-[10px] border border-slate-300/60 bg-slate-50/82 px-3 py-3 text-slate-700 shadow-[inset_0_0_12px_rgba(255,255,255,0.65)]">
				<div className="mb-2 text-[13px] font-semibold leading-5 tracking-[0.08em] text-slate-700 min-[1280px]:text-[14px]">
					数据来源:
				</div>
				<div className="flex flex-col gap-1.5">
					{compositionItems.map((source) => (
						<div className="flex min-w-0 items-center gap-2" key={source.label}>
							<img
								alt=""
								aria-hidden="true"
								className="h-5 w-5 flex-none object-contain drop-shadow-[0_1px_3px_rgba(15,23,42,0.28)] min-[1280px]:h-6 min-[1280px]:w-6"
								draggable={false}
								src={source.iconUrl}
							/>
							<span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-5 min-[1280px]:text-[13px]">
								{source.label}
							</span>
							<span className="flex-none text-[12px] font-semibold leading-5 text-[#9a6f34] min-[1280px]:text-[13px]">
								+{formatCultivationNumber(source.value)}
							</span>
						</div>
					))}
				</div>
			</div>
		</NineSliceImageFrame>
	);
}
