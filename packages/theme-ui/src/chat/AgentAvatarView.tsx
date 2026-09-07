import { cn } from "@vetta/ui";
import type { JSX } from "react";
import { agentAvatarBackgroundStyle } from "./agent-tint";

export interface AgentAvatarViewProps {
	readonly name: string;
	readonly avatar?: string;
	readonly blueprintId?: string;
	/** 挑底座配色用的稳定身份，通常是 Agent id；缺省时退回名字。 */
	readonly seed?: string;
	/** 档案里存的底座：`tint:<preset>` 或 `#rrggbb`；缺省按 seed 自动分配。 */
	readonly background?: string;
	readonly active?: boolean;
	readonly size?: AgentAvatarSize;
	readonly className?: string;
}

export type AgentAvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "hero";

/** 尺寸 → [外框, 内边距, 字号]；内边距让透明底的头像图不贴边。 */
const SIZE_CLASS: Record<AgentAvatarSize, string> = {
	xs: "h-4 w-4 p-px text-[9px]",
	sm: "h-5 w-5 p-0.5 text-[10px]",
	md: "h-6 w-6 p-0.5 text-[10px]",
	lg: "h-7 w-7 p-1 text-[11px]",
	xl: "h-9 w-9 p-1 text-[13px]",
	hero: "h-14 w-14 p-2 text-[18px]",
};

/**
 * 全应用唯一的 Agent 头像：智能体中心定的那套「彩色底座 + 透明头像图」，
 * 消息流、输入栏、成员条、编队页共用同一枚组件，改样式只用改这里。
 */
export function AgentAvatarView({
	name,
	avatar,
	blueprintId = "leader",
	seed,
	background,
	active = false,
	size = "md",
	className,
}: AgentAvatarViewProps): JSX.Element {
	const initial = Array.from(name.trim())[0]?.toLocaleUpperCase();
	return (
		<span
			aria-hidden="true"
			style={agentAvatarBackgroundStyle(background, seed || name || blueprintId)}
			className={cn(
				// 底座下缘接近白色，兜底首字母固定用深色，避免深色主题下白字消失。
				"inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium text-black/70 ring-1 ring-border",
				active && "ring-primary/60",
				SIZE_CLASS[size],
				className,
			)}
		>
			{avatar ? (
				<img src={avatar} alt="" className="h-full w-full object-contain" />
			) : (
				(initial ?? <span className={cn(blueprintIcon(blueprintId), "h-1/2 w-1/2")} />)
			)}
		</span>
	);
}

function blueprintIcon(blueprintId: string): string {
	if (blueprintId === "researcher") return "icon-[solar--magnifer-linear]";
	if (blueprintId === "builder") return "icon-[solar--code-square-linear]";
	if (blueprintId === "reviewer") return "icon-[solar--shield-check-linear]";
	return "icon-[solar--crown-star-linear]";
}
