/** 无界详情：用字号、留白和章节细线分层，不用卡片边框把内容装箱。 */

export const DETAIL_SECTION_TITLE = "text-[15px] font-semibold tracking-tight text-foreground";

export const DETAIL_KICKER = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60";

export const DETAIL_RULE = "border-t border-border/40";

/** 能力清单：短条目横排。步骤、对照、Hero、指标各走自己的语义布局。 */
export const DETAIL_FLOW = "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-8 gap-y-5";

/** 章节标题：字 + 一条淡线，分节但不画盒子。 */
export function DetailChapterTitle({ children }: { children: string | undefined }): JSX.Element | null {
	if (!children) return null;
	return (
		<div className="flex items-center gap-3">
			<h2 className={DETAIL_SECTION_TITLE}>{children}</h2>
			<span className="h-px min-w-4 flex-1 bg-border/40" aria-hidden />
		</div>
	);
}
