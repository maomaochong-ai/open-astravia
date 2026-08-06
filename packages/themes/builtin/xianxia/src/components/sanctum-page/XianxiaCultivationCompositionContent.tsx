import { Fragment, type JSX } from "react";
import { sanctumPageAssets } from "./assets";
import type { CultivationCompositionItem } from "./cultivationComposition";
import { CultivationPanelContentLayout } from "./CultivationPanelContentLayout";
import { formatCultivationNumber } from "./cultivationView";

export function XianxiaCultivationCompositionContent({
	currentPower,
	items,
	maxPower,
	onOpenRules,
}: {
	readonly currentPower: number;
	readonly items: readonly CultivationCompositionItem[];
	readonly maxPower: number;
	readonly onOpenRules: () => void;
}): JSX.Element {
	return (
		<CultivationPanelContentLayout
			footer={
				<div className="flex w-full items-center justify-between gap-3 text-[13px] leading-5 text-slate-600">
					<span className="min-w-0">完成任务、引用知识库、生成有效结果、建立自动化都会累计修为。</span>
					<button
						className="inline-flex shrink-0 items-center gap-1 font-semibold text-slate-700 outline-none transition hover:text-slate-900 border border-transparent focus-visible:border-amber-200/80"
						onClick={onOpenRules}
						type="button"
					>
						了解规则
						<span className="icon-[solar--alt-arrow-right-linear] h-4 w-4" />
					</button>
				</div>
			}
			header={
				<div className="flex min-w-0 items-baseline gap-2">
					<h3 className="text-[22px] font-semibold leading-7 text-slate-800">修为值构成</h3>
					<span className="text-[13px] text-slate-500">（基于真实使用行为）</span>
				</div>
			}
			main={
				<CompositionMetricsRow
					currentPower={currentPower}
					items={items}
					maxPower={maxPower}
				/>
			}
		/>
	);
}

/**
 * Equal-width metric columns with dedicated gutters for + / =,
 * so operators stay centered on the icon row and columns are not squeezed.
 */
function CompositionMetricsRow({
	currentPower,
	items,
	maxPower,
}: {
	readonly currentPower: number;
	readonly items: readonly CultivationCompositionItem[];
	readonly maxPower: number;
}): JSX.Element {
	const powerPercent = maxPower > 0 ? Math.round((currentPower / maxPower) * 100) : 0;
	const contributionTotal = items.reduce((sum, item) => sum + item.value, 0);

	const columns = [
		...items.map((item) => ({
			iconUrl: item.iconUrl,
			key: item.label,
			label: item.label,
			primary: `${item.percent}%`,
			secondary: `${formatCultivationNumber(item.value)} / ${formatCultivationNumber(contributionTotal)}`,
		})),
		{
			iconUrl: sanctumPageAssets.cultivationCompositionIcons.power,
			key: "power",
			label: "修为值",
			primary: `${powerPercent}%`,
			secondary: `${formatCultivationNumber(currentPower)} / ${formatCultivationNumber(maxPower)}`,
		},
	] as const;

	return (
		<div className="flex w-full items-stretch justify-between">
			{columns.map((column, index) => (
				<Fragment key={column.key}>
					{index > 0 && (
						<div aria-hidden="true" className="flex w-7 shrink-0 flex-col items-center">
							{/* Spacer matches label row so operator lines up with icons */}
							<div className="h-5 shrink-0" />
							<div className="mt-2.5 flex h-14 w-full items-center justify-center text-[28px] leading-none text-slate-500/80">
								{index === columns.length - 1 ? "=" : "+"}
							</div>
						</div>
					)}
					<div className="flex min-w-0 flex-1 flex-col items-center text-center">
						<div className="h-5 w-full truncate text-[13px] font-semibold leading-5 text-slate-600">
							{column.label}
						</div>
						<img
							alt=""
							aria-hidden="true"
							className="mt-2.5 h-14 w-14 shrink-0 object-contain drop-shadow-[0_2px_7px_rgba(15,23,42,0.28)]"
							draggable={false}
							src={column.iconUrl}
						/>
						<div className="mt-2.5 text-[24px] font-semibold leading-7 text-slate-800">{column.primary}</div>
						<div className="mt-1 text-[12px] leading-4 text-slate-500">{column.secondary}</div>
					</div>
				</Fragment>
			))}
		</div>
	);
}
