interface PromptAttachmentLabelsProps {
	/** 逐条渲染成一枚名字；空数组不渲染整行。 */
	labels: readonly string[];
	/** 插件自带的来源图标（iconify 类名）。 */
	icon?: string;
	removeLabel: string;
	onRemove(): void;
}

/**
 * 插件挂在输入框上的引用，画在输入卡片**外面**的下沿：一排带来源图标的徽标。
 *
 * 放在卡片下方而不是上方：上方紧挨着的是正在写的那句话，横插一行会把视线从输入位置
 * 拉走；下沿本来就是附属信息区（待办、语音状态），这行跟它们是同一类东西。
 *
 * 徽标而非卡片内的胶囊：卡片里那圈胶囊（场景、图片）是「这一条要发的东西」，而插件
 * 附件描述的是「你现在正看着什么」——它跟着画布选中变，不该抢走卡片里的位置。
 */
export function PromptAttachmentLabels({
	labels,
	icon,
	removeLabel,
	onRemove,
}: PromptAttachmentLabelsProps): JSX.Element | null {
	if (labels.length === 0) return null;

	return (
		<div className="group/attachment mt-1.5 flex items-center gap-1.5 px-1">
			{/* 条目多到放不下时整行横向滚动，不换行——它在卡片外面，换行会把输入栏顶起来。 */}
			<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{/* 不做入场/退场动画：这行跟着画布选中走，选中每变一次它就得动一次，
				    任何位移都读成「有东西飞进来」而不是「你选的东西变了」。 */}
				{labels.map((label) => (
					<span
						key={label}
						title={label}
						className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/60 px-2 py-[3px] text-[12px] font-medium leading-none text-foreground/80"
					>
						{/* 图标进到每一枚徽标里：一行里可能挂着不同来源，放在行首只能说明第一枚。 */}
						{icon ? <span className={`${icon} h-3 w-3 shrink-0 text-muted-foreground`} /> : null}
						{label}
					</span>
				))}
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
