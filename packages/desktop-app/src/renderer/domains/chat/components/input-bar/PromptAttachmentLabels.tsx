import { AnimatePresence, motion } from "motion/react";

interface PromptAttachmentLabelsProps {
	/** 逐条渲染成 `#xxx`；空数组不渲染整行。 */
	labels: readonly string[];
	/** 插件自带的来源图标（iconify 类名）。 */
	icon?: string;
	removeLabel: string;
	onRemove(): void;
}

/**
 * 插件挂在输入框上的引用，画在输入卡片**外面**的顶部：来源图标 + 一串 `#xxx`。
 *
 * 刻意不是胶囊：卡片里那圈胶囊（场景、图片）是「这一条要发的东西」，而插件附件
 * 描述的是「你现在正看着什么」——它跟着画布选中变，不该抢走卡片里的位置，也不该
 * 看起来像用户自己加进去的一件附件。
 */
export function PromptAttachmentLabels({
	labels,
	icon,
	removeLabel,
	onRemove,
}: PromptAttachmentLabelsProps): JSX.Element | null {
	if (labels.length === 0) return null;

	return (
		<div className="group/attachment mb-1.5 flex items-center gap-1.5 px-1">
			{icon ? <span className={`${icon} h-3.5 w-3.5 shrink-0 text-muted-foreground`} /> : null}
			{/* 条目多到放不下时整行横向滚动，不换行——它在卡片外面，换行会把输入框往下推。 */}
			<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				<AnimatePresence initial={false}>
					{labels.map((label) => (
						<motion.span
							key={label}
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -4 }}
							transition={{ duration: 0.15 }}
							className="shrink-0 text-[12px] font-medium text-foreground/80"
							title={label}
						>
							<span className="text-muted-foreground/70">#</span>
							{label}
						</motion.span>
					))}
				</AnimatePresence>
			</div>
			<button
				type="button"
				onClick={onRemove}
				title={removeLabel}
				aria-label={removeLabel}
				className="shrink-0 text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-hover/attachment:opacity-100 focus-visible:opacity-100 hover:text-foreground"
			>
				<span className="icon-[solar--close-circle-linear] block h-3.5 w-3.5" />
			</button>
		</div>
	);
}
