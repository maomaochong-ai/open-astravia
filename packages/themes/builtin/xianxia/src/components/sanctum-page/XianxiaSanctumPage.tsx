import type { ThemePageProps } from "@vetta-org/theme-sdk";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type JSX } from "react";
import { sanctumAchievements } from "./achievements";
import { useSanctumCultivationView } from "./cultivationView";
import { getRealmDetailView } from "./realmDetailData";
import { XianxiaAchievementPanel } from "./XianxiaAchievementPanel";
import { XianxiaBottomBar } from "./XianxiaBottomBar";
import { XianxiaCultivationPowerPanel } from "./XianxiaCultivationPowerPanel";
import { XianxiaProfileColumn } from "./XianxiaProfileColumn";
import { XianxiaRealmDetailPanel } from "./XianxiaRealmDetailPanel";
import { XianxiaSanctumPageHeader } from "./XianxiaSanctumPageHeader";
import type { SanctumCultivationView } from "./types";

export function XianxiaSanctumPage({ layout }: ThemePageProps): JSX.Element {
	const cultivation = useSanctumCultivationView();

	useEffect(() => {
		document.body.classList.add("xianxia-sanctum-page-active");
		return () => {
			document.body.classList.remove("xianxia-sanctum-page-active");
		};
	}, []);

	return (
		<main
			className="relative flex min-h-0 flex-1 items-start justify-center overflow-auto rounded-[22px] border border-white/35 bg-transparent"
			data-theme-page-layout={layout}
		>
			<motion.div
				animate={{ opacity: 1 }}
				className="relative flex min-h-full w-full max-w-[1440px] flex-none flex-col overflow-visible"
				initial={{ opacity: 0 }}
				transition={{ duration: 0.45, ease: "easeOut" }}
			>
				<XianxiaSanctumPageHeader />
				<div className="grid min-h-0 grid-cols-1 gap-7 px-8 pb-5 pt-2 min-[1060px]:grid-cols-[430px_minmax(410px,1fr)] xl:grid-cols-[470px_minmax(0,1fr)]">
					<XianxiaProfileColumn cultivation={cultivation} />
					<XianxiaSanctumContentColumn cultivation={cultivation} />
				</div>
				<XianxiaBottomBar cultivation={cultivation} />
			</motion.div>
		</main>
	);
}

function XianxiaSanctumContentColumn({
	cultivation,
}: {
	readonly cultivation: SanctumCultivationView;
}): JSX.Element {
	const [selectedAchievementId, setSelectedAchievementId] = useState<string | null>(null);
	const selectedAchievement =
		sanctumAchievements.find((achievement) => achievement.id === selectedAchievementId) ?? null;

	return (
		<motion.section
			animate={{ opacity: 1, x: 0 }}
			className="relative flex w-[530px] min-w-0 flex-col gap-5 self-start justify-self-center min-[1060px]:w-full"
			initial={{ opacity: 0, x: 18 }}
			transition={{ delay: 0.1, duration: 0.5, ease: "easeOut" }}
		>
			<XianxiaCultivationPowerPanel cultivation={cultivation} />
			<XianxiaAchievementPanel
				cultivation={cultivation}
				onSelectAchievement={setSelectedAchievementId}
				selectedAchievementId={selectedAchievementId}
			/>
			<AnimatePresence>
				{selectedAchievement && (
					<XianxiaRealmDetailPanel
						detail={getRealmDetailView(selectedAchievement, cultivation)}
						onClose={() => setSelectedAchievementId(null)}
					/>
				)}
			</AnimatePresence>
		</motion.section>
	);
}
