import { cn } from "@vetta-org/ui";
import type { JSX } from "react";

export interface SessionRowMoreButtonProps {
	/** Tailwind radius class matching the row it overlays. */
	className?: string;
	label?: string;
	onOpen: (event: React.MouseEvent) => void;
}

/**
 * 会话行右侧的「更多」入口，hover 时淡入，点开的菜单与右键完全一致。
 *
 * 之所以是行的兄弟节点而不是行内子节点：行本身就是 <button>，按钮不能嵌套按钮。
 * 渐隐底色用 --accent 而非实色——mac 经典侧边栏是原生毛玻璃，任何不透明底色都会在
 * 那里糊出一块死板的方块（见 styles.css 里侧边栏 --accent 的改写）。
 */
export function SessionRowMoreButton({
	className,
	label,
	onOpen,
}: SessionRowMoreButtonProps): JSX.Element {
	const open = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		onOpen(event);
	};
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			data-session-more-trigger="true"
			onClick={open}
			onContextMenu={open}
			className={cn(
				"absolute inset-y-0 right-0 flex w-10 items-center justify-end pr-2",
				"bg-gradient-to-l from-accent via-accent/80 to-transparent",
				"opacity-0 transition-opacity group-hover/session-row:opacity-100 focus-visible:opacity-100",
				className,
			)}
		>
			<span className="icon-[solar--menu-dots-bold] h-4 w-4 text-muted-foreground" />
		</button>
	);
}

/** hover 时把行内容向右淡出，保证「更多」图标下面的文字不会和图标叠在一起。 */
export const SESSION_ROW_CONTENT_FADE_CLASS =
	"group-hover/session-row:[mask-image:linear-gradient(to_left,transparent_10px,#000_42px)]";
