import { CenterSliceImageDecoration, HorizontalSliceImageFrame, NineSliceImageFrame } from "@vetta/theme-ui";
import { cn } from "@vetta/ui";
import { motion } from "motion/react";
import type { CSSProperties, JSX } from "react";
import { sanctumAchievements, type SanctumAchievement } from "./achievements";
import { sanctumPageAssets } from "./assets";
import type { SanctumCultivationView } from "./types";

const achievementLayoutStyle: CSSProperties & {
	readonly "--sanctum-achievement-connector-width": string;
	readonly "--sanctum-achievement-gap-size": string;
	readonly "--sanctum-achievement-size": string;
} = {
	"--sanctum-achievement-connector-width": "calc(var(--sanctum-achievement-gap-size) + var(--sanctum-achievement-size) * 0.32)",
	"--sanctum-achievement-gap-size": "calc(var(--sanctum-achievement-size) * 0.11)",
	"--sanctum-achievement-size": "8.75rem",
};
const achievementConnectorDecoration = {
	centerWidth: "1rem",
	height: "1.7rem",
} as const;
const statusLabelDecoration = {
	height: "1.25rem",
	leftSlice: 60,
	leftWidth: "0.75rem",
	repeat: "stretch",
	rightSlice: 60,
	rightWidth: "0.75rem",
} as const;
const achievementPanelDecoration = {
	borderWidth: "3.5rem",
	repeat: "stretch",
	slice: 132,
} as const;

export function XianxiaAchievementPanel({
	cultivation,
	onSelectAchievement,
	selectedAchievementId,
}: {
	readonly cultivation: SanctumCultivationView;
	readonly onSelectAchievement: (achievementId: string) => void;
	readonly selectedAchievementId: string | null;
}): JSX.Element {
	return (
		<section className="relative w-full min-w-0">
			<NineSliceImageFrame
				className="w-full"
				contentClassName="xianxia-achievement-panel-content relative z-10 flex w-full min-w-0 flex-col px-4 py-7 md:px-8 md:py-9"
				decoration={achievementPanelDecoration}
				imageUrl={sanctumPageAssets.achievementDisplayPanel}
				style={achievementLayoutStyle}
			>
				<div className="flex items-center gap-2 px-6 text-slate-700">
					<span className="text-[18px] text-slate-400">✧</span>
					<h2 className="text-[20px] font-semibold leading-7 text-slate-800">修仙境界</h2>
					<span className="text-[13px] font-semibold leading-5 text-slate-500">（共十五境界）</span>
				</div>
				<div className="xianxia-achievement-grid">
					{sanctumAchievements.map((achievement, index) => (
						<XianxiaAchievementCell
							key={achievement.id}
							achievement={achievement}
							achieved={cultivation.achievedRealmIds.includes(achievement.id)}
							assetIndex={index}
							current={achievement.id === cultivation.realmId}
							onSelect={onSelectAchievement}
							selected={achievement.id === selectedAchievementId}
							showConnector={index < sanctumAchievements.length - 1}
						/>
					))}
				</div>
			</NineSliceImageFrame>
		</section>
	);
}

function XianxiaAchievementCell({
	achievement,
	achieved,
	assetIndex,
	current,
	onSelect,
	selected,
	showConnector,
}: {
	readonly achievement: SanctumAchievement;
	readonly achieved: boolean;
	readonly assetIndex: number;
	readonly current: boolean;
	readonly onSelect: (achievementId: string) => void;
	readonly selected: boolean;
	readonly showConnector: boolean;
}): JSX.Element {
	const icon = achieved
		? sanctumPageAssets.achievements.unlocked[assetIndex]
		: sanctumPageAssets.achievements.locked[assetIndex];

	return (
		<motion.figure
			animate={{ opacity: 1, scale: 1, y: 0 }}
			className="xianxia-achievement-cell relative flex min-w-0 flex-col items-center justify-center rounded-[18px] px-1 pb-2 pt-1 text-center"
			initial={{ opacity: 0, scale: 0.92, y: 10 }}
			transition={{ delay: 0.18 + assetIndex * 0.035, duration: 0.28, ease: "easeOut" }}
		>
			{current && (
				<img
					alt=""
					aria-hidden="true"
					className="pointer-events-none absolute left-1/2 top-[35px] z-0 h-auto w-[82%] max-w-none -translate-x-1/2"
					src={sanctumPageAssets.currentAchievementBackground}
				/>
			)}
			<button
				aria-pressed={selected}
				className="relative z-10 flex min-w-0 flex-col items-center rounded-[16px] outline-none transition hover:brightness-110 border border-transparent focus-visible:border-amber-200/80"
				onClick={() => onSelect(achievement.id)}
				type="button"
			>
				<img
					alt=""
					aria-hidden="true"
					className={cn(
						"w-auto max-w-none",
						current ? "h-[calc(var(--sanctum-achievement-size)*1.2)]" : "h-[var(--sanctum-achievement-size)]",
						achieved
							? "drop-shadow-[0_0_9px_rgba(202,255,240,0.56)]"
							: "opacity-80 saturate-[0.72] drop-shadow-[0_0_5px_rgba(255,255,255,0.38)]",
					)}
					src={icon}
				/>
				<span className="mt-1.5 min-w-0 text-xs font-semibold leading-tight text-slate-700 drop-shadow-[0_1px_0_rgba(255,255,255,0.85)]">
					<span className="block truncate">{achievement.englishName}</span>
					<span className="mt-0.5 block text-[13px] text-slate-600">{achievement.name}</span>
				</span>
			</button>
			<div className="relative z-10">
				<AchievementStatusLabel achieved={achieved} current={current} />
			</div>
			{showConnector && (
				<motion.div
					animate={{ opacity: 1, scaleX: 1 }}
					className="sanctum-achievement-connector pointer-events-none absolute right-[calc(var(--sanctum-achievement-connector-width)*-0.6)] h-[1.7rem] w-[var(--sanctum-achievement-connector-width)]"
					initial={{ opacity: 0, scaleX: 0.65 }}
					transition={{ delay: 0.24 + assetIndex * 0.035, duration: 0.3, ease: "easeOut" }}
				>
					<CenterSliceImageDecoration
						className="opacity-[0.86] drop-shadow-[0_0_4px_rgba(255,255,255,0.5)]"
						decoration={achievementConnectorDecoration}
						imageUrl={sanctumPageAssets.achievementConnector}
					/>
				</motion.div>
			)}
		</motion.figure>
	);
}

function AchievementStatusLabel({
	achieved,
	current,
}: {
	readonly achieved: boolean;
	readonly current: boolean;
}): JSX.Element {
	const frame = current
		? sanctumPageAssets.statusLabels.current
		: achieved
			? sanctumPageAssets.statusLabels.completed
			: sanctumPageAssets.statusLabels.locked;

	return (
		<HorizontalSliceImageFrame
			className={cn(
				"mx-auto mt-1.5 inline-flex h-5 w-fit items-center justify-center px-2.5 text-[11px] leading-4",
				current || achieved ? "text-white" : "text-slate-600",
			)}
			contentClassName="relative z-10 flex h-full items-center justify-center"
			decoration={statusLabelDecoration}
			imageUrl={frame}
		>
			<span className="whitespace-nowrap font-semibold">{current ? "Current" : achieved ? "Completed" : "Locked"}</span>
		</HorizontalSliceImageFrame>
	);
}
