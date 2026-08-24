import { forwardRef, type ComponentPropsWithoutRef, type JSX } from "react";
import { motion } from "motion/react";
import { useThemeSurface } from "@astravia/theme-sdk/appearance";
import { cn } from "@astravia/ui";
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
				"relative shrink-0 overflow-visible whitespace-nowrap rounded-xl border text-[11px] font-medium shadow-sm transition-colors",
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
					"relative z-10 flex items-center gap-1.5 overflow-hidden rounded-[inherit] py-1 pl-1 pr-3",
					classNames?.content,
				)}
			>
				<span
					className={cn(
						"flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border",
						active
							? "border-primary/25 bg-primary/15 text-primary"
							: "border-border/60 bg-muted/60 text-muted-foreground",
						classNames?.icon,
					)}
				>
					<span className="icon-[mdi--puzzle-outline] h-3.5 w-3.5" />
				</span>
				<span className={classNames?.label}>{item.alias || item.name}</span>
			</span>
		</motion.button>
	);
});
