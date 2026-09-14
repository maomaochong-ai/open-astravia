import { forwardRef, type ComponentPropsWithoutRef, type JSX } from "react";
import { motion } from "motion/react";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { cn } from "@vetta-org/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import type { NewSessionSceneActionState, NewSessionSceneItem } from "./NewSession";

const SPRING = { type: "spring" as const, stiffness: 460, damping: 32 };

export type SceneCardState = NewSessionSceneItem["state"];
export type SceneCardActionState = NewSessionSceneActionState;
export type SceneCardModel = NewSessionSceneItem;

export interface SceneCardClassNames {
	content?: string;
	description?: string;
	meta?: string;
	status?: string;
	title?: string;
}

export interface SceneCardProps extends Omit<ComponentPropsWithoutRef<typeof motion.button>, "children"> {
	action: SceneCardActionState;
	classNames?: SceneCardClassNames;
	item: SceneCardModel;
	selected: boolean;
}

export const SceneCard = forwardRef<HTMLButtonElement, SceneCardProps>(function SceneCard(
	{ action, className, classNames, item, selected, ...props },
	ref,
): JSX.Element {
	const surface = useThemeSurface("chat.newSessionSceneCard");
	const muted = item.state !== "active";
	const selectedActive = item.state === "active" && selected;

	return (
		<motion.button
			ref={ref}
			type="button"
			disabled={action === "loading"}
			whileHover={{ y: -2 }}
			whileTap={{ scale: 0.98 }}
			transition={SPRING}
			className={cn(
				"relative min-w-0 w-[calc((100%-1rem)/3)] shrink-0 snap-start overflow-visible rounded-xl border text-left transition-colors disabled:cursor-wait",
				selectedActive
					? "border-primary/60 bg-card shadow-[0_10px_24px_-18px_var(--primary)]"
					: muted
						? "border-dashed border-border/50 bg-card/60 hover:border-primary/40"
						: "border-border/60 bg-card hover:border-primary/40",
				surface?.rootClassName,
				className,
			)}
			data-theme-surface-root="chat.newSessionSceneCard"
			{...props}
		>
			<ThemeSurface slot="chat.newSessionSceneCard" />
			<span
				className={cn(
					"relative z-10 flex w-full min-w-0 items-start gap-2.5 overflow-hidden rounded-[inherit] p-3",
					classNames?.content,
				)}
			>
				<span className="block min-w-0 flex-1 overflow-hidden">
					<span
						className={cn(
							"block truncate text-[13px] font-semibold",
							muted ? "text-muted-foreground" : "text-foreground",
							classNames?.title,
						)}
					>
						{item.alias || item.name}
					</span>
					{item.description && (
						<span
							className={cn(
								"mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70",
								classNames?.description,
							)}
						>
							{item.description}
						</span>
					)}
					{(item.version || (item.downloadCount ?? 0) > 0) && (
						<span
							className={cn(
								"mt-1.5 flex items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground/60",
								classNames?.meta,
							)}
						>
							{item.version && (
								<span className="inline-flex h-4 items-center rounded-full bg-accent/50 px-1.5 font-medium">
									v{item.version}
								</span>
							)}
							{(item.downloadCount ?? 0) > 0 && (
								<span className="inline-flex h-4 items-center gap-0.5 rounded-full bg-accent/50 px-1.5 font-medium">
									<span className="icon-[mdi--download] h-2.5 w-2.5" />
									{item.downloadCount}
								</span>
							)}
						</span>
					)}
				</span>
				{action === "loading" ? (
					<span
						className={cn(
							"icon-[mdi--loading] h-3.5 w-3.5 shrink-0 animate-spin text-primary",
							classNames?.status,
						)}
					/>
				) : action === "error" ? (
					<span
						className={cn(
							"icon-[mdi--alert-circle] h-3.5 w-3.5 shrink-0 text-destructive",
							classNames?.status,
						)}
					/>
				) : muted ? (
					<span
						className={cn(
							"icon-[mdi--download] h-3.5 w-3.5 shrink-0 text-muted-foreground/60",
							classNames?.status,
						)}
					/>
				) : selectedActive ? (
					<span
						className={cn(
							"icon-[mdi--check-circle] h-3.5 w-3.5 shrink-0 text-primary",
							classNames?.status,
						)}
					/>
				) : null}
			</span>
		</motion.button>
	);
});
