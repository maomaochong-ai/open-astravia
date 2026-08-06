import type { JSX } from "react";
import {
	CULTIVATION_RULE_CATEGORIES,
	getRuleMetricValue,
} from "./cultivationRules";
import { CultivationPanelContentLayout } from "./CultivationPanelContentLayout";
import { formatCultivationNumber } from "./cultivationView";
import type { SanctumCultivationView } from "./types";

export function XianxiaCultivationRulesContent({
	onBack,
	scoreBreakdown,
}: {
	readonly onBack: () => void;
	readonly scoreBreakdown: SanctumCultivationView["scoreBreakdown"];
}): JSX.Element {
	return (
		<CultivationPanelContentLayout
			footer={
				<p className="w-full text-[12px] leading-5 text-slate-500">
					修为分由上述指标加权求和，并映射至当前境界进度条；仅统计聚合使用数据，不记录对话原文。
				</p>
			}
			header={
				<div className="flex min-w-0 items-center gap-2">
					<button
						aria-label="返回修为构成"
						className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-slate-600 outline-none transition hover:bg-slate-900/6 hover:text-slate-800 border border-transparent focus-visible:border-amber-200/80"
						onClick={onBack}
						type="button"
					>
						<span className="icon-[solar--alt-arrow-left-linear] h-4 w-4" />
					</button>
					<div className="min-w-0">
						<h3 className="text-[22px] font-semibold leading-7 text-slate-800">修为累计规则</h3>
						<p className="text-[13px] leading-5 text-slate-500">各项真实行为如何折算修为（与当前分值同步）</p>
					</div>
				</div>
			}
			main={
				<div className="xianxia-hidden-scrollbar max-h-[22rem] w-full space-y-3 overflow-y-auto pr-1">
					{CULTIVATION_RULE_CATEGORIES.map((category) => (
						<section className="rounded-[12px] border border-slate-300/45 bg-white/45 px-3 py-2.5" key={category.id}>
							<div className="mb-2 flex items-center gap-2">
								<img
									alt=""
									aria-hidden="true"
									className="h-7 w-7 object-contain"
									draggable={false}
									src={category.iconUrl}
								/>
								<h4 className="text-[15px] font-semibold leading-5 text-slate-800">{category.label}</h4>
							</div>
							<div className="space-y-1.5">
								{category.items.map((item) => {
									const value = getRuleMetricValue(scoreBreakdown, item.key);
									return (
										<div
											className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] px-1 py-1"
											key={item.key}
										>
											<img
												alt=""
												aria-hidden="true"
												className="h-7 w-7 object-contain"
												draggable={false}
												src={item.iconUrl}
											/>
											<div className="min-w-0">
												<div className="truncate text-[13px] font-semibold leading-4 text-slate-700">{item.label}</div>
												<div className="truncate text-[12px] leading-4 text-slate-500">{item.description}</div>
											</div>
											<div className="text-right text-[13px] font-semibold tabular-nums leading-4 text-slate-700">
												{formatCultivationNumber(value)}
											</div>
										</div>
									);
								})}
							</div>
						</section>
					))}
				</div>
			}
		/>
	);
}
