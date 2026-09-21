import type { JSX } from "react";

export interface RemoteSessionBadgeViewProps {
	/** 一般是远端主机名。主机名由用户自己起，长度不可控，故在此截断。 */
	label: string;
	/** 悬停提示，一般给远端主机与路径，便于确认连的是哪台机器。 */
	title?: string;
}

/**
 * 顶栏标题右侧徽标：当前会话属于远程（SSH）项目时显示。
 * 本地会话由 host container 渲染 null，本 View 仅负责 badge UI。
 */
export function RemoteSessionBadgeView({ label, title }: RemoteSessionBadgeViewProps): JSX.Element {
	return (
		<span
			className="no-drag inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
			title={title}
		>
			<span className="icon-[solar--server-2-linear] h-3.5 w-3.5 shrink-0" />
			<span className="max-w-[12rem] truncate">{label}</span>
		</span>
	);
}
