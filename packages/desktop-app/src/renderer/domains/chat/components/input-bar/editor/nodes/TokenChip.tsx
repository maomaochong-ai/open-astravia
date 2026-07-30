/**
 * 行内 token 的统一外观：半透明主题色底 + 描边的小徽标，随文本流换行。
 *
 * 对齐要点：外层用 inline-block 而不是 inline-flex。inline-flex 的基线取自
 * 第一个 flex item——也就是那个空的图标 span，它的基线是自身底边，于是整枚徽标
 * 相对正文被抬高（视觉上不居中）。inline-block 的基线取自内部最后一行文本，
 * 与正文基线天然对齐；图标改为普通 inline-block 元素，靠 vertical-align 微调。
 */
export function TokenChip({
	icon,
	label,
	title,
}: {
	icon: string;
	label: string;
	title?: string;
}): JSX.Element {
	return (
		<span
			className="mx-px inline-block max-w-full select-none whitespace-pre rounded-md border border-primary/25 bg-primary/10 px-1.5 align-baseline text-[12px] font-medium leading-[1.6] text-primary"
			title={title ?? label}
			data-input-token="true"
		>
			<span className={`${icon} mr-1 inline-block h-3 w-3 align-[-0.15em]`} />
			{label}
		</span>
	);
}
