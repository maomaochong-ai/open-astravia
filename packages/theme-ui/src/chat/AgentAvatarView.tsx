import { cn } from "@vetta/ui";
import type { JSX } from "react";

export interface AgentAvatarViewProps {
	readonly name: string;
	readonly avatar?: string;
	readonly active?: boolean;
	readonly size?: AgentAvatarSize;
	readonly className?: string;
}

export type AgentAvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "hero";

/** 尺寸 → [外框, 字号]；头像图满幅铺满圆形，只有兜底首字母用得上字号。 */
const SIZE_CLASS: Record<AgentAvatarSize, string> = {
	xs: "h-4 w-4 text-[9px]",
	sm: "h-5 w-5 text-[10px]",
	md: "h-6 w-6 text-[10px]",
	lg: "h-7 w-7 text-[11px]",
	xl: "h-9 w-9 text-[13px]",
	hero: "h-14 w-14 text-[18px]",
};

/**
 * 全应用唯一的 Agent 头像：头像图是自带背景的方形立绘，直接裁成圆形满幅铺满。
 * 没有头像图时才退回首字母或兜底图标。消息流、输入栏、成员条、编队页共用同一枚组件。
 */
export function AgentAvatarView({
	name,
	avatar,
	active = false,
	size = "md",
	className,
}: AgentAvatarViewProps): JSX.Element {
	const initial = Array.from(name.trim())[0]?.toLocaleUpperCase();
	return (
		<span
			aria-hidden="true"
			className={cn(
				// 头像图满幅铺满，兜底首字母才看得到底色。
				"inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground ring-1 ring-border",
				active && "ring-primary/60",
				SIZE_CLASS[size],
				className,
			)}
		>
			{avatar ? (
				<img src={avatar} alt="" className="h-full w-full object-cover" />
			) : (
				(initial ?? <span className={cn(blueprintIcon(), "h-1/2 w-1/2")} />)
			)}
		</span>
	);
}

/** 没有头像也没有首字母时的兜底图标。宿主不认识具体角色，所以只有一个。 */
function blueprintIcon(): string {
	return "icon-[solar--crown-star-linear]";
}
