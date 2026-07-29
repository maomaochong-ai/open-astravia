import { forwardRef, type JSX } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { cn } from "@vetta/ui";

export interface SettingsAiAssistButtonViewProps {
	readonly label: string;
	readonly className?: string;
	readonly onClick?: () => void;
}

const wandVariants: Variants = {
	idle: { rotate: 0, scale: 1 },
	pulse: {
		rotate: [0, -8, 8, -4, 0],
		transition: {
			duration: 2.4,
			repeat: Number.POSITIVE_INFINITY,
			ease: "easeInOut",
			repeatDelay: 1.2,
		},
	},
	hover: {
		scale: 1.08,
		rotate: 12,
		transition: { type: "spring", stiffness: 380, damping: 22 },
	},
};

/**
 * Compact AI-assist CTA: animated magic-wand icon + short label.
 * Ref-forwarding so it can act as PopoverTrigger (asChild).
 */
export const SettingsAiAssistButtonView = forwardRef<HTMLButtonElement, SettingsAiAssistButtonViewProps>(
	function SettingsAiAssistButtonView({ label, className, onClick }, ref): JSX.Element {
		const reduceMotion = useReducedMotion();

		return (
			<motion.button
				ref={ref}
				type="button"
				onClick={onClick}
				title={label}
				aria-label={label}
				data-settings-ai-assist-trigger=""
				initial="idle"
				animate={reduceMotion ? "idle" : "pulse"}
				whileHover={reduceMotion ? undefined : "hover"}
				whileTap={reduceMotion ? undefined : { scale: 0.95 }}
				className={cn(
					"group relative inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 overflow-visible rounded-md border border-transparent px-1",
					"bg-transparent text-[12px] font-medium text-primary outline-none select-none",
					"transition-opacity duration-200 ease-out hover:opacity-90",
					"focus-visible:border-ring",
					"disabled:pointer-events-none disabled:opacity-50",
					className,
				)}
			>
				<span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
					<motion.span
						aria-hidden
						variants={wandVariants}
						className="icon-[solar--magic-stick-3-bold] relative z-[1] h-3.5 w-3.5"
					/>
					<TwinkleStar
						reduceMotion={!!reduceMotion}
						className="-top-1 -right-1"
						size={5}
						delay={0}
						hoverX={3}
						hoverY={-4}
					/>
					<TwinkleStar
						reduceMotion={!!reduceMotion}
						className="-bottom-1 -left-1"
						size={3.5}
						delay={0.45}
						hoverX={-3}
						hoverY={3}
					/>
					<TwinkleStar
						reduceMotion={!!reduceMotion}
						className="-top-0.5 -left-1.5"
						size={2.5}
						delay={0.9}
						hoverX={-4}
						hoverY={-2}
					/>
				</span>
				<span className="relative z-[1] whitespace-nowrap">{label}</span>
			</motion.button>
		);
	},
);

function TwinkleStar({
	className,
	size,
	delay,
	hoverX,
	hoverY,
	reduceMotion,
}: {
	className: string;
	size: number;
	delay: number;
	hoverX: number;
	hoverY: number;
	reduceMotion: boolean;
}): JSX.Element {
	const variants: Variants = {
		idle: { opacity: 0.85, scale: 1, x: 0, y: 0 },
		pulse: {
			opacity: [0.25, 1, 0.35, 1, 0.25],
			scale: [0.7, 1.15, 0.85, 1.1, 0.7],
			x: 0,
			y: 0,
			transition: {
				duration: 2.2,
				repeat: Number.POSITIVE_INFINITY,
				ease: "easeInOut",
				delay,
			},
		},
		hover: {
			x: hoverX,
			y: hoverY,
			scale: 1.35,
			opacity: 1,
			transition: { type: "spring", stiffness: 380, damping: 22 },
		},
	};

	return (
		<motion.span
			aria-hidden
			variants={variants}
			animate={reduceMotion ? "idle" : undefined}
			className={cn("pointer-events-none absolute z-[2] text-primary", className)}
			style={{ width: size, height: size }}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 784.11 815.53"
				className="h-full w-full fill-current drop-shadow-[0_0_4px_color-mix(in_srgb,var(--primary)_70%,transparent)]"
			>
				<path d="M392.05 0c-20.9,210.08-184.06,378.41-392.05,407.78 207.96,29.37 371.12,197.68 392.05,407.74 20.93-210.06 184.09-378.37 392.05-407.74-207.98-29.38-371.16-197.69-392.06-407.78z" />
			</svg>
		</motion.span>
	);
}
