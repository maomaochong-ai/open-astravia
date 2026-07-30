import type { ReactNode } from "react";

export interface ActiveActionCapsule {
	id: string;
	label: string;
	icon?: ReactNode;
	onToggle: () => void;
}

/**
 * 已激活的 input action（知识检索、插件开关）在工具栏里的常驻提示，
 * 紧跟在执行模式（权限/沙箱）右侧，外观与它对齐：同样的 h-7 / rounded-lg /
 * text-muted-foreground，hover 时同样的 bg-accent/60 + text-foreground。
 *
 * 全量开关列表在命令面板里，但这些开关跨消息持续生效、还会随会话恢复，
 * 面板一关就完全不可见的话用户会忘记自己开着。
 * hover 时图标变成关闭图标，点图标即取消该 action。
 */
export function ActiveActionCapsules({
	items,
	removeHint,
}: {
	items: readonly ActiveActionCapsule[];
	removeHint: string;
}): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<div className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden">
			{items.map((item) => (
				<div
					key={item.id}
					title={item.label}
					className="group flex h-7 min-w-0 shrink items-center gap-1 rounded-lg px-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground @[22rem]:gap-1.5 @[22rem]:px-2"
				>
					{/* 图标本身是取消按钮：hover 时原图标淡出、关闭图标淡入 */}
					<button
						type="button"
						onClick={item.onToggle}
						title={`${item.label} · ${removeHint}`}
						className="relative h-3.5 w-3.5 shrink-0"
					>
						{item.icon ? (
							<span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
								{item.icon}
							</span>
						) : null}
						<span className="icon-[solar--close-circle-linear] absolute inset-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
					</button>
					<span className="min-w-0 max-w-[6rem] truncate">{item.label}</span>
				</div>
			))}
		</div>
	);
}
