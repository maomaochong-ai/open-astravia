import { HorizontalSliceImageDecoration, HorizontalSliceImageFrame } from "@vetta/theme-ui";
import { motion } from "motion/react";
import type { JSX } from "react";
import { sanctumPageAssets } from "./assets";
import type { SanctumCultivationView } from "./types";
import { XianxiaGrowthReportDialog } from "./XianxiaGrowthReportDialog";

const bottomBarFrameDecoration = {
	height: "100%",
	leftSlice: 150,
	leftWidth: "9rem",
	repeat: "stretch",
	rightSlice: 150,
	rightWidth: "9rem",
} as const;
const bottomBarButtonDecoration = {
	height: "100%",
	leftSlice: 168,
	leftWidth: "4.25rem",
	repeat: "stretch",
	rightSlice: 168,
	rightWidth: "4.25rem",
} as const;

export function XianxiaBottomBar({
	cultivation,
}: {
	readonly cultivation: SanctumCultivationView;
}): JSX.Element {
	return (
		<motion.footer
			animate={{ opacity: 1, y: 0 }}
			className="mx-8 mb-5 mt-auto text-slate-700"
			initial={{ opacity: 0, y: 18 }}
			transition={{ delay: 0.25, duration: 0.45, ease: "easeOut" }}
		>
			<HorizontalSliceImageFrame
				className="w-full"
				contentClassName="relative z-10 flex min-h-[7.25rem] items-center justify-between gap-5 px-12 py-8"
				decoration={bottomBarFrameDecoration}
				imageUrl={sanctumPageAssets.bottomBar.background}
			>
				<div className="flex items-center gap-5">
					<img alt="" aria-hidden="true" className="h-14 w-auto max-w-none flex-none object-contain" src={sanctumPageAssets.bottomBar.compass} />
					<p className="w-[360px] text-[14px] leading-5">Each realm breakthrough unlocks new abilities, boosts attributes, and opens the path to higher cultivation.</p>
				</div>
				<div className="h-11 w-px bg-slate-400/45" />
				<div className="flex items-center gap-5">
					<img alt="" aria-hidden="true" className="h-14 w-auto max-w-none flex-none object-contain" src={sanctumPageAssets.bottomBar.scroll} />
					<p className="w-[310px] text-[14px] leading-5">Complete tasks, accumulate cultivation, and transcend to higher realms.</p>
				</div>
				<XianxiaGrowthReportDialog cultivation={cultivation}>
					<button
						type="button"
						className="relative flex h-14 flex-none items-center justify-center px-9 text-[18px] font-semibold text-white outline-none transition hover:brightness-110 border border-transparent focus-visible:border-amber-200/80"
					>
						<HorizontalSliceImageDecoration
							decoration={bottomBarButtonDecoration}
							imageUrl={sanctumPageAssets.bottomBar.button}
						/>
						<span className="relative z-10 flex items-center gap-3">
							<img alt="" aria-hidden="true" className="h-7 w-auto max-w-none object-contain" src={sanctumPageAssets.bottomBar.book} />
							<span>View Cultivation Record</span>
							<span className="icon-[solar--arrow-right-linear] h-5 w-5" />
						</span>
					</button>
				</XianxiaGrowthReportDialog>
			</HorizontalSliceImageFrame>
		</motion.footer>
	);
}
