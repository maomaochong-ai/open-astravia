import { cn } from "@vetta-org/ui";
import { AnimatePresence, motion } from "motion/react";
import type { JSX } from "react";
import { sanctumPageAssets } from "./assets";
import { formatCultivationNumber } from "./cultivationView";

function getCultivationNumberGlyphs(value: number): readonly string[] {
	return formatCultivationNumber(value).split("");
}

export function XianxiaCultivationNumber({
	className,
	digitClassName,
	prefix,
	value,
}: {
	readonly className?: string;
	readonly digitClassName: string;
	readonly prefix?: string;
	readonly value: number;
}): JSX.Element {
	return (
		<span className={cn("inline-flex items-end tabular-nums", className)}>
			{prefix && <span className="mr-1 font-semibold leading-none text-amber-50">{prefix}</span>}
			{getCultivationNumberGlyphs(value).map((glyph, index) =>
				glyph === "," ? (
					<span
						aria-hidden="true"
						className={cn(
							"mx-0.5 flex aspect-[2/8] flex-none items-end justify-center overflow-hidden font-semibold leading-none text-amber-50",
							digitClassName,
						)}
						key={`${glyph}-${index}`}
					>
						<span className="translate-y-[-0.06em]">,</span>
					</span>
				) : (
					<span
						className={cn(
							"relative inline-flex aspect-[5/8] flex-none items-center justify-center overflow-hidden",
							digitClassName,
						)}
						key={index}
					>
						<AnimatePresence initial={false} mode="popLayout">
							<motion.img
								alt={glyph}
								animate={{ opacity: 1, y: 0 }}
								className="absolute h-full w-auto max-w-none object-contain"
								draggable={false}
								exit={{ opacity: 0, y: "-105%" }}
								initial={{ opacity: 0, y: "105%" }}
								key={glyph}
								src={sanctumPageAssets.cultivationDigits[Number(glyph)]}
								transition={{ duration: 0.28, ease: "easeOut" }}
							/>
						</AnimatePresence>
					</span>
				),
			)}
		</span>
	);
}
