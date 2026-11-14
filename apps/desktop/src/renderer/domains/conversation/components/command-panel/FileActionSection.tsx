import type { CommandPanelFileAction } from "./types";

/**
 * 「添加」面板里的文件区段（ADR-0156）。
 *
 * 三段动作原先分散在工具行右侧的两个独立按钮上（添加图片 / 附加文件引用），
 * 而「添加文件」要绕去文件树。挪进面板后，用户从同一条入口就能把「往这条消息里加什么」
 * 想完，工具行也少两个按钮。
 *
 * 这里是直接动作而不是可搜索条目，所以不参与过滤词筛选，也不进键盘索引——
 * 与连接器宫格的处理一致。
 */
export function FileActionSection({
	items,
	title,
}: {
	readonly items: readonly CommandPanelFileAction[];
	readonly title: string;
}): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<div className="px-3 pb-1 pt-2">
			<div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
				{title}
			</div>
			<div className="flex flex-col">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={item.onSelect}
						title={item.label}
						className="flex h-8 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-foreground/5"
					>
						<span className={`${item.icon} h-4 w-4 shrink-0 text-muted-foreground`} />
						<span className="min-w-0 truncate text-[12.5px] text-foreground">{item.label}</span>
					</button>
				))}
			</div>
		</div>
	);
}
