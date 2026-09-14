import { motion } from "motion/react";
import { useThemeSurface } from "@vetta-org/theme-sdk";
import { ThemeSurface, type NewSessionGuidingWordsProps } from "@vetta-org/theme-ui";
import { cn } from "@vetta-org/ui";
import type { JSX } from "react";
import { xianxiaAssets } from "../assets";

// 与 DefaultGuidingWords / GUIDING_WORD_PAGE=3 对齐：固定单行槽位，避免轮播引起页面抖动。
const WORD_SLOT_CLASS = "h-8";
const WORD_LIST_MIN_H_CLASS = "min-h-24";

export function XianxiaGuidingWords({
	className,
	groups,
	mounted,
	onPick,
	...props
}: NewSessionGuidingWordsProps): JSX.Element {
	const surface = useThemeSurface("chat.newSessionGuidingWords");
	const columnsClass =
		groups.length <= 1 ? "grid-cols-1" : "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]";

	return (
		<div
			className={cn(
				"xianxia-guiding-words relative mt-5 w-full overflow-visible rounded-[20px] border border-transparent px-5 py-4",
				surface?.rootClassName,
				className,
			)}
			data-theme-surface-root="chat.newSessionGuidingWords"
			{...props}
		>
			<ThemeSurface
				className="xianxia-guiding-words-frame overflow-visible"
				slot="chat.newSessionGuidingWords"
			/>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 z-[1] overflow-hidden rounded-[inherit]"
			>
				<img
					alt=""
					className="absolute right-0 -bottom-5 h-[116px] w-auto max-w-[42%] object-contain object-right-bottom opacity-90"
					src={xianxiaAssets.inputBarBackground}
				/>
			</div>
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 8 }}
				transition={{ duration: 0.5, delay: 0.35 }}
				className={cn("relative z-10 grid items-start gap-x-4", columnsClass)}
			>
				{groups.map((group) => (
					<div key={group.id} className="flex min-w-0 flex-col gap-2">
						<div className="truncate text-[13px] font-semibold text-foreground/90" title={group.name}>
							{group.name}
						</div>
						<motion.div
							key={group.pageKey}
							initial="initial"
							animate="animate"
							variants={{ animate: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } } }}
							className={cn("flex min-w-0 flex-col", WORD_LIST_MIN_H_CLASS)}
						>
							{group.words.map((word, index) => (
								<motion.button
									key={`${group.pageKey}-${index}-${word}`}
									type="button"
									onClick={() => onPick(word)}
									variants={{
										initial: { opacity: 0, x: -6 },
										animate: { opacity: 1, x: 0 },
									}}
									transition={{ duration: 0.5 }}
									whileTap={{ scale: 0.98 }}
									title={word}
									className={cn(
										WORD_SLOT_CLASS,
										"flex w-full min-w-0 shrink-0 items-center overflow-hidden border-l border-primary/20 px-3 py-1.5 text-left text-[12px] leading-relaxed text-muted-foreground transition-colors hover:text-primary",
									)}
								>
									<span className="block min-w-0 flex-1 truncate">{word}</span>
								</motion.button>
							))}
						</motion.div>
					</div>
				))}
			</motion.div>
		</div>
	);
}
