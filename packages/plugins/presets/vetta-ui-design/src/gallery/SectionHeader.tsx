import type { ReactNode } from "react";

/**
 * 画廊首页的分区标题（「我的设计」「风格库」）。
 *
 * 两个分区此前各写了一份视觉几乎相同、细节又对不齐的 header；抽出来是为了让
 * 首页只有一套分区语言：主色竖条 + 标题 + 计数/说明 + 右侧动作。
 */
export interface SectionHeaderProps {
	title: string;
	/** 标题右侧的计数胶囊（已格式化的文案）。 */
	badge?: string;
	/** 计数之外的一句说明，空间不够时截断。 */
	hint?: string;
	/** 右端动作区，例如「查看全部」。 */
	action?: ReactNode;
}

export function SectionHeader({ title, badge, hint, action }: SectionHeaderProps) {
	return (
		<header className="mb-4 flex min-w-0 items-center gap-2">
			{/* 纯装饰：给分区一个起点，比单靠字号区分层级更稳（标题很短时也成立）。 */}
			<span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-primary/70" />
			<h2 className="shrink-0 text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
			{badge ? (
				<span className="shrink-0 rounded-full bg-accent/60 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
					{badge}
				</span>
			) : null}
			{hint ? <p className="min-w-0 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
			<div className="flex-1" />
			{action}
		</header>
	);
}
