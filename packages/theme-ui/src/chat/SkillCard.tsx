import { forwardRef, type ComponentPropsWithoutRef, type JSX } from "react";
import { motion } from "motion/react";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { cn } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import type { NewSessionSkillItem } from "./NewSession";

export type SkillCardModel = NewSessionSkillItem;

export interface SkillCardClassNames {
	content?: string;
	icon?: string;
	label?: string;
}

export interface SkillCardProps extends Omit<ComponentPropsWithoutRef<typeof motion.button>, "children"> {
	active: boolean;
	classNames?: SkillCardClassNames;
	item: SkillCardModel;
}

export const SkillCard = forwardRef<HTMLButtonElement, SkillCardProps>(function SkillCard(
	{ active, className, classNames, item, ...props },
	ref,
): JSX.Element {
	const surface = useThemeSurface("chat.newSessionSkillCard");

	return (
		<motion.button
			ref={ref}
			type="button"
			whileTap={{ scale: 0.96 }}
			className={cn(
				"relative shrink-0 overflow-visible whitespace-nowrap rounded-full border text-[11px] font-medium transition-colors",
				active
					? "border-primary/50 bg-[color-mix(in_srgb,var(--primary)_15%,var(--card))] text-primary"
					: "border-border/60 bg-card text-muted-foreground hover:border-primary/30 hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))] hover:text-primary",
				surface?.rootClassName,
				className,
			)}
			data-theme-surface-root="chat.newSessionSkillCard"
			{...props}
		>
			<ThemeSurface slot="chat.newSessionSkillCard" />
			<span
				className={cn(
					"relative z-10 flex items-center gap-1.5 overflow-hidden rounded-[inherit] px-3 py-1",
					classNames?.content,
				)}
			>
				<span className={cn("icon-[mdi--puzzle-outline] h-3 w-3", classNames?.icon)} />
				<span className={classNames?.label}>{item.alias || item.name}</span>
			</span>
		</motion.button>
	);
});
