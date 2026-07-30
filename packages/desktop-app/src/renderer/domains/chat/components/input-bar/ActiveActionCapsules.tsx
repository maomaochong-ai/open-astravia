import type { ReactNode } from "react";

export interface ActiveActionCapsule {
	id: string;
	label: string;
	icon?: ReactNode;
	onToggle: () => void;
}

/**
 * 已激活的 input action（知识检索、插件开关）在输入卡片里的常驻提示。
 *
 * 全量开关列表搬进了命令面板，但这些开关是跨消息持续生效、还会随会话恢复的，
 * 面板一关就完全不可见的话用户会忘记自己开着。点一下即关闭。
 * 不复用 InputBarCapsule：插件的图标是 ReactNode，而那个组件只接图标类名。
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
		<div className="flex flex-wrap items-center gap-1.5">
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={item.onToggle}
					title={`${item.label} · ${removeHint}`}
					className="group flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
				>
					{item.icon ? <span className="flex h-3 w-3 items-center justify-center">{item.icon}</span> : null}
					<span className="max-w-[12rem] truncate">{item.label}</span>
					<span className="icon-[solar--close-circle-linear] h-3 w-3 opacity-40 transition-opacity group-hover:opacity-100" />
				</button>
			))}
		</div>
	);
}
