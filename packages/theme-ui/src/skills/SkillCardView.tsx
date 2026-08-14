import type { JSX } from "react";
import { motion } from "motion/react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { SkillTypeIcon } from "./skill-icon";
import { SkillToggleSwitch } from "./SkillToggleSwitch";

export interface SkillCardSkillView {
	readonly name: string;
	readonly alias?: string | null;
	readonly type: "skill" | "scene";
	readonly description?: string | null;
	/** 空=默认；solar:xxx-bold；或已解析的图片 URL */
	readonly icon?: string | null;
	readonly installed: boolean;
	readonly enabled: boolean;
	readonly isCustom?: boolean;
	readonly isAgent?: boolean;
	readonly isReadonly?: boolean;
	readonly needsUpdate?: boolean;
	readonly localVersion?: string | null;
	readonly downloadCount: number;
}

export interface SkillCardViewLabels {
	readonly custom: string;
	readonly general: string;
	readonly updatable: string;
	readonly noDescription: string;
	readonly readonly: string;
	readonly update: string;
	readonly uninstall: string;
	readonly install: string;
}

export interface SkillCardViewProps {
	readonly skill: SkillCardSkillView;
	readonly labels: SkillCardViewLabels;
	readonly isLoading: boolean;
	readonly previewable: boolean;
	readonly onInstall: () => void;
	readonly onToggle: () => void;
	readonly onUninstall: () => void;
	readonly onPreview?: () => void;
}

export function SkillCardView({
	skill,
	labels,
	isLoading,
	previewable,
	onInstall,
	onToggle,
	onUninstall,
	onPreview,
}: SkillCardViewProps): JSX.Element {
	return (
		<motion.div
			variants={{
				hidden: { opacity: 0, y: 8 },
				show: { opacity: 1, y: 0 },
			}}
			transition={{ type: "spring", stiffness: 320, damping: 26 }}
			onClick={previewable ? onPreview : undefined}
			className={`group relative flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 transition-colors duration-200 hover:bg-accent ${
				previewable ? "cursor-pointer" : ""
			}`}
		>
			<div
				className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg transition-colors ${
					skill.installed ? "bg-primary/10 text-primary" : "bg-accent/50 text-muted-foreground/70"
				}`}
			>
				<SkillTypeIcon type={skill.type} icon={skill.icon} className="h-4 w-4" />
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-[13px] font-semibold text-foreground">
						{skill.alias || skill.name}
					</span>
					{skill.installed && skill.localVersion && (
						<span className="inline-flex h-4 shrink-0 items-center rounded-full bg-accent/50 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/70">
							v{skill.localVersion}
						</span>
					)}
					{!skill.isCustom && skill.downloadCount > 0 && (
						<span className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-accent/50 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/70">
							<span className="icon-[mdi--download] h-2.5 w-2.5" />
							{skill.downloadCount}
						</span>
					)}
					{skill.isCustom && (
						<span className="inline-flex h-4 shrink-0 items-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
							{labels.custom}
						</span>
					)}
					{skill.isAgent && (
						<span className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-accent/60 px-1.5 text-[10px] font-medium text-muted-foreground/80">
							<span className="icon-[mdi--earth] h-2.5 w-2.5" />
							{labels.general}
						</span>
					)}
					{skill.needsUpdate && (
						<span className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-400">
							<span className="icon-[mdi--arrow-up-bold] h-2.5 w-2.5" />
							{labels.updatable}
						</span>
					)}
				</div>
				<p className="mt-0.5 line-clamp-1 text-[12px] leading-[1.5] text-muted-foreground/60">
					{skill.description || labels.noDescription}
				</p>
			</div>

			<div className="flex shrink-0 items-center gap-1.5">
				{skill.isAgent ? (
					<span className="flex h-7 items-center gap-1 px-1.5 text-[11px] text-muted-foreground/50">
						<span className="icon-[mdi--lock-outline] h-3.5 w-3.5" />
						{labels.readonly}
					</span>
				) : skill.installed ? (
					<>
						<Popover>
							<PopoverTrigger asChild>
								<button
									type="button"
									onClick={(e) => e.stopPropagation()}
									className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-60 transition-all group-hover:opacity-100 hover:bg-primary/10 hover:text-primary"
								>
									<span className="icon-[mdi--dots-horizontal] h-4 w-4" />
								</button>
							</PopoverTrigger>
							<PopoverContent align="end" className="w-36 p-1">
								{skill.needsUpdate && (
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											onInstall();
										}}
										disabled={isLoading}
										className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
									>
										<span className="icon-[mdi--update] h-4 w-4 text-primary" />
										{labels.update}
									</button>
								)}
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										onUninstall();
									}}
									disabled={isLoading}
									className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
								>
									<span className="icon-[mdi--delete-outline] h-4 w-4" />
									{labels.uninstall}
								</button>
							</PopoverContent>
						</Popover>
						<SkillToggleSwitch checked={skill.enabled} onChange={onToggle} disabled={isLoading} />
					</>
				) : (
					<Button
						type="button"
						variant="primary"
						size="sm"
						onClick={(e) => {
							e.stopPropagation();
							onInstall();
						}}
						disabled={isLoading}
					>
						{isLoading ? (
							<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
						) : (
							<span className="icon-[mdi--plus] h-3.5 w-3.5" />
						)}
						<span>{labels.install}</span>
					</Button>
				)}
			</div>
		</motion.div>
	);
}
