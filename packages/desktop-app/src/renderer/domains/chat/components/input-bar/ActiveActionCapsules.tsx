import type { ReactNode } from "react";

export interface ActiveActionCapsule {
	id: string;
	label: string;
	icon?: ReactNode;
	onToggle: () => void;
}

/**
 * 已激活的 input action（知识检索、插件开关）在工具栏里的常驻提示，
 * 紧跟在执行模式（权限/沙箱）右侧。
 *
 * 全量开关列表在命令面板里，但这些开关跨消息持续生效、还会随会话恢复，
 * 面板一关就完全不可见的话用户会忘记自己开着。点一下即关闭。
 * 刻意不做成徽标（无底色无描边）——它与左边的执行模式是同一排的状态指示，
 * 加了底色反而比真正的操作按钮更抢眼。
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
		<div className="flex min-w-0 shrink items-center gap-1 overflow-hidden">
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={item.onToggle}
					title={`${item.label} · ${removeHint}`}
					className="flex min-w-0 shrink items-center gap-1 px-1 text-[11.5px] font-medium text-primary transition-opacity hover:opacity-60"
				>
					{item.icon ? (
						<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{item.icon}</span>
					) : null}
					<span className="truncate">{item.label}</span>
				</button>
			))}
		</div>
	);
}
