import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@vetta/ui";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import type { ContentModelDescriptor } from "../generation/types";
import type { ContentProjectDocument } from "../project/types";
import { createContentProjectMenuSummary } from "./project-menu-summary";

interface CanvasProjectMenuProps {
	project: ContentProjectDocument;
	models: readonly ContentModelDescriptor[];
	onFitContent: () => void;
	onFocusNodes: (nodeIds: readonly string[]) => void;
	onResetZoom: () => void;
	onOpenSettings: () => void;
}

const UNTITLED_WORKFLOW_TITLE = "Untitled content workflow";

export function CanvasProjectMenu({
	project,
	models,
	onFitContent,
	onFocusNodes,
	onResetZoom,
	onOpenSettings,
}: CanvasProjectMenuProps) {
	const { t } = useTranslation();
	const summary = useMemo(() => createContentProjectMenuSummary(project, models), [models, project]);
	const title = project.workflow.title === UNTITLED_WORKFLOW_TITLE ? t("projectMenu.untitled") : project.workflow.title;
	const activeJobCount = summary.activeJobNodeIds.length;
	const failedJobCount = summary.failedJobNodeIds.length;

	return (
		<div className="pointer-events-auto absolute left-3 top-3 z-20 max-w-[min(360px,calc(100%_-_24px))]">
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className="flex h-10 max-w-full items-center gap-2 rounded-xl border border-border/80 bg-popover/90 px-2.5 text-left text-popover-foreground shadow-sm backdrop-blur-md outline-none transition-colors hover:bg-popover focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
						aria-label={t("projectMenu.open")}
					>
						<span className="icon-[lucide--menu] block size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span className="min-w-0 truncate text-[12px] font-medium">{title}</span>
						{activeJobCount > 0 ? (
							<span
								className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
								aria-label={t("projectMenu.jobs.active", { count: activeJobCount })}
							/>
						) : null}
						<span
							className="icon-[lucide--chevron-down] block size-3.5 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-[300px]" sideOffset={8}>
					<div className="px-3 pb-2 pt-2">
						<p className="m-0 truncate text-[13px] font-medium text-popover-foreground">{title}</p>
						<p className="mb-0 mt-0.5 truncate text-[11px] text-muted-foreground">
							{summary.workspaceName ?? t("workspace.global")}
						</p>
						<div className="mt-3 grid grid-cols-3 divide-x divide-border rounded-lg bg-muted/45 py-2 text-center">
							<ProjectStat value={summary.nodeCount} label={t("projectMenu.stats.nodes")} />
							<ProjectStat value={summary.assetCount} label={t("projectMenu.stats.assets")} />
							<ProjectStat value={summary.modelCount} label={t("projectMenu.stats.models")} />
						</div>
					</div>

					<DropdownMenuSeparator />
					<DropdownMenuLabel>{t("projectMenu.section.canvas")}</DropdownMenuLabel>
					<ProjectMenuItem icon="icon-[lucide--scan]" onSelect={onFitContent} disabled={summary.nodeCount === 0}>
						{t("projectMenu.action.fitContent")}
					</ProjectMenuItem>
					<ProjectMenuItem
						icon="icon-[lucide--search]"
						onSelect={onResetZoom}
						meta={t("projectMenu.zoom.default")}
					>
						{t("projectMenu.action.resetZoom")}
					</ProjectMenuItem>

					<DropdownMenuSeparator />
					<DropdownMenuLabel>{t("projectMenu.section.jobs")}</DropdownMenuLabel>
					<ProjectMenuItem
						icon="icon-[lucide--loader-circle]"
						onSelect={() => onFocusNodes(summary.activeJobNodeIds)}
						disabled={activeJobCount === 0}
						meta={activeJobCount}
					>
						{t("projectMenu.action.activeJobs")}
					</ProjectMenuItem>
					<ProjectMenuItem
						icon="icon-[lucide--circle-alert]"
						onSelect={() => onFocusNodes(summary.failedJobNodeIds)}
						disabled={failedJobCount === 0}
						meta={failedJobCount}
					>
						{t("projectMenu.action.failedJobs")}
					</ProjectMenuItem>

					<DropdownMenuSeparator />
					<ProjectMenuItem icon="icon-[lucide--settings-2]" onSelect={onOpenSettings}>
						{t("projectMenu.action.settings")}
					</ProjectMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function ProjectStat({ value, label }: { value: number; label: string }) {
	return (
		<span className="flex min-w-0 flex-col px-1">
			<strong className="text-[13px] font-semibold tabular-nums text-foreground">{value}</strong>
			<span className="truncate text-[10px] text-muted-foreground">{label}</span>
		</span>
	);
}

function ProjectMenuItem({
	icon,
	meta,
	children,
	...props
}: Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & {
	icon: string;
	meta?: ReactNode;
	children: ReactNode;
}) {
	return (
		<DropdownMenuItem {...props}>
			<span className={`${icon} block size-4 shrink-0 text-muted-foreground`} aria-hidden="true" />
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{meta !== undefined ? <MenuItemMeta>{meta}</MenuItemMeta> : null}
		</DropdownMenuItem>
	);
}

function MenuItemMeta({ children }: { children: ReactNode }) {
	return <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{children}</span>;
}
