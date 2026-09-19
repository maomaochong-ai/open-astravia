import { memo, type JSX } from "react";

/**
 * hover / press 的缩放走 CSS transform：这些按钮常驻在输入栏里，用 motion 组件
 * 等于每次输入栏重渲都要重建一份动画状态机，而效果 CSS 一行就能给到。
 */
const INTERACTION_CLASS =
	"transition-transform duration-150 ease-out will-change-transform hover:scale-[1.06] active:scale-[0.92]";

export interface InputBarToolbarButtonProps {
	icon: string;
	title: string;
	disabled?: boolean;
	onClick?: () => void;
	active?: boolean;
}

export const InputBarToolbarButton = memo(function InputBarToolbarButton({
	icon,
	title,
	disabled,
	onClick,
	active,
}: InputBarToolbarButtonProps): JSX.Element {
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-30 ${
				disabled ? "" : INTERACTION_CLASS
			} ${
				active
					? "bg-primary/10 text-primary"
					: "text-foreground hover:bg-accent/60"
			}`}
		>
			<span className={`${icon} h-[17px] w-[17px]`} />
		</button>
	);
});
