import { motion } from "motion/react";
import type { SkillListLabels } from "./types";

const CARD_IN = { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] as const };

interface SkillListEmptyProps {
	/** true = 有过滤词但没命中；false = 本来就没有可用的 skill / 场景。 */
	filtering: boolean;
	labels: SkillListLabels;
}

/**
 * skill 列表的空态卡片：占满命令区宽度的一张虚线卡片 + 图标 + 标题 + 提示。
 * 只有一行灰字时空态看起来像「加载没完」，卡片能明确「这就是结果」。
 */
export function SkillListEmpty({ filtering, labels }: SkillListEmptyProps): JSX.Element {
	return (
		<div className="px-3 py-2">
			<motion.div
				initial={{ opacity: 0, y: 4 }}
				animate={{ opacity: 1, y: 0 }}
				transition={CARD_IN}
				className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-foreground/[0.02] px-4 py-6 text-center"
			>
				<span className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground/70">
					<span
						className={[
							"h-4 w-4",
							filtering ? "icon-[solar--minimalistic-magnifer-linear]" : "icon-[solar--widget-5-linear]",
						].join(" ")}
					/>
				</span>
				<span className="text-[12.5px] font-medium text-foreground/80">
					{filtering ? labels.emptyNoMatch : labels.emptyNoSkills}
				</span>
				<span className="max-w-[320px] text-[11px] leading-relaxed text-muted-foreground/50">
					{filtering ? labels.emptyNoMatchHint : labels.emptyNoSkillsHint}
				</span>
			</motion.div>
		</div>
	);
}
