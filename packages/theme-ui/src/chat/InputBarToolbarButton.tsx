import { memo, type JSX } from "react";
import { motion } from "motion/react";

const SPRING = { type: "spring" as const, stiffness: 460, damping: 32, mass: 0.9 };
const TOOLBAR_BUTTON_HOVER = { scale: 1.06 };
const TOOLBAR_BUTTON_TAP = { scale: 0.92 };

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
		<motion.button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			whileHover={!disabled ? TOOLBAR_BUTTON_HOVER : undefined}
			whileTap={!disabled ? TOOLBAR_BUTTON_TAP : undefined}
			transition={SPRING}
			className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-30 ${
				active
					? "bg-primary/10 text-primary"
					: "text-foreground hover:bg-accent/60"
			}`}
		>
			<span className={`${icon} h-[17px] w-[17px]`} />
		</motion.button>
	);
});
