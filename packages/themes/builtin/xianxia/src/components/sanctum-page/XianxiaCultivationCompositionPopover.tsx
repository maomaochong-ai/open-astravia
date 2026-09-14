import { NineSliceImageFrame } from "@vetta-org/theme-ui";
import { cn } from "@vetta-org/ui";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState, type JSX } from "react";
import { sanctumPageAssets } from "./assets";
import type { CultivationCompositionItem, CultivationPanelView } from "./cultivationComposition";
import {
	contentSlideTransition,
	contentSlideVariants,
	cultivationCompositionPanelDecoration,
	PANEL_WIDTH_CLASS,
} from "./cultivationPanelChrome";
import type { SanctumCultivationView } from "./types";
import { XianxiaCultivationCompositionContent } from "./XianxiaCultivationCompositionContent";
import { XianxiaCultivationRulesContent } from "./XianxiaCultivationRulesContent";

/**
 * Fixed nine-slice shell for composition / rules; only the inner content slides.
 */
export function XianxiaCultivationCompositionPopover({
	currentPower,
	direction,
	items,
	maxPower,
	onBackToComposition,
	onExitComplete,
	onOpenRules,
	open,
	scoreBreakdown,
	view,
}: {
	readonly currentPower: number;
	readonly direction: 1 | -1;
	readonly items: readonly CultivationCompositionItem[];
	readonly maxPower: number;
	readonly onBackToComposition: () => void;
	readonly onExitComplete: () => void;
	readonly onOpenRules: () => void;
	readonly open: boolean;
	readonly scoreBreakdown: SanctumCultivationView["scoreBreakdown"];
	readonly view: CultivationPanelView;
}): JSX.Element {
	const activeContentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number | "auto">("auto");

	useLayoutEffect(() => {
		const node = activeContentRef.current;
		if (!node) return;
		setContentHeight(node.offsetHeight);
	}, [view, currentPower, items, maxPower, scoreBreakdown]);

	return (
		<motion.div
			animate={open ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.96, y: -10 }}
			className={cn(
				PANEL_WIDTH_CLASS,
				"origin-top text-slate-700 drop-shadow-[0_8px_20px_rgba(15,23,42,0.28)]",
			)}
			initial={{ opacity: 0, scale: 0.96, y: -10 }}
			onAnimationComplete={() => {
				if (!open) onExitComplete();
			}}
			style={{ pointerEvents: open ? "auto" : "none" }}
			transition={{ duration: 0.22, ease: "easeOut" }}
		>
			<NineSliceImageFrame
				className="w-full"
				contentClassName="relative z-10 overflow-hidden px-7"
				decoration={cultivationCompositionPanelDecoration}
				imageUrl={sanctumPageAssets.cultivationCompositionPanel}
			>
				<motion.div
					animate={{ height: contentHeight }}
					className="relative overflow-hidden"
					initial={false}
					transition={contentSlideTransition}
				>
					<AnimatePresence custom={direction} initial={false}>
						<motion.div
							animate="center"
							className="w-full"
							custom={direction}
							exit="exit"
							initial="enter"
							key={view}
							ref={activeContentRef}
							transition={contentSlideTransition}
							variants={contentSlideVariants}
						>
							{view === "composition" ? (
								<XianxiaCultivationCompositionContent
									currentPower={currentPower}
									items={items}
									maxPower={maxPower}
									onOpenRules={onOpenRules}
								/>
							) : (
								<XianxiaCultivationRulesContent
									onBack={onBackToComposition}
									scoreBreakdown={scoreBreakdown}
								/>
							)}
						</motion.div>
					</AnimatePresence>
				</motion.div>
			</NineSliceImageFrame>
		</motion.div>
	);
}
