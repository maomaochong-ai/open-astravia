import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@vetta/ui";
import { useState, type JSX } from "react";

export interface ProjectPickerProps {
	projects: Array<{ path: string; name?: string }>;
	/** 当前选择的项目路径；空串 = 用看板默认项目。 */
	value: string;
	/** 空串对应的默认项目路径，用于在触发器上显示它实际是谁。 */
	defaultCwd: string;
	onChange: (path: string) => void;
	triggerClassName?: string;
	/**
	 * 允许手输项目之外的自定义路径（编辑弹窗开；Composer 不开——快速入池时选列表
	 * 就够了，真要特殊路径可以在编辑弹窗里补）。
	 */
	allowCustomPath?: boolean;
}

export function projectLabel(path: string, name?: string): string {
	if (name?.trim()) return name.trim();
	const segments = path.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

/** 目标项目选择器。Composer 与卡片编辑弹窗共用，语义一致：空串 = 跟随看板默认。 */
export function ProjectPicker({
	allowCustomPath,
	defaultCwd,
	onChange,
	projects,
	triggerClassName,
	value,
}: ProjectPickerProps): JSX.Element {
	const { t } = useTranslation();
	const [customMode, setCustomMode] = useState(false);
	const effective = value || defaultCwd;
	const known = projects.find((project) => project.path === effective);
	// 卡片上存了一个项目列表之外的路径（手输过 / 项目被移除）时仍要如实显示。
	const label = effective ? projectLabel(effective, known?.name) : t("composer.noProject");

	if (customMode) {
		return (
			<div className={cn("flex h-8 items-center gap-1 rounded-md border border-border bg-background pl-2 pr-1", triggerClassName)}>
				<span className="icon-[solar--folder-path-connect-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<input
					value={value}
					autoFocus
					placeholder={t("projectPicker.customPlaceholder")}
					onChange={(event) => onChange(event.target.value)}
					className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
				/>
				<button
					type="button"
					title={t("projectPicker.backToList")}
					onClick={() => setCustomMode(false)}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<span className="icon-[solar--list-linear] h-3.5 w-3.5" />
				</button>
			</div>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					title={t("composer.project")}
					className={cn(
						"flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground",
						triggerClassName,
					)}
				>
					<span className="icon-[solar--folder-linear] h-3.5 w-3.5 shrink-0" />
					<span className="min-w-0 flex-1 truncate text-left">{label}</span>
					<span className="icon-[solar--alt-arrow-down-linear] h-2.5 w-2.5 shrink-0 opacity-60" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent data-vetta-plugin-root="kanban" align="start" className="max-h-64 w-60 overflow-y-auto">
				{projects.map((project) => (
					<DropdownMenuItem
						key={project.path}
						onSelect={() => onChange(project.path === defaultCwd ? "" : project.path)}
						className="flex items-center gap-2 text-[12px]"
					>
						<span
							className={cn(
								"icon-[solar--folder-linear] h-3.5 w-3.5 shrink-0",
								project.path === effective ? "text-primary" : "text-muted-foreground",
							)}
						/>
						<span className="min-w-0 flex-1 truncate">{projectLabel(project.path, project.name)}</span>
						{project.path === defaultCwd && (
							<span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
								{t("projectPicker.defaultBadge")}
							</span>
						)}
						{project.path === effective && (
							<span className="icon-[solar--check-read-linear] h-3.5 w-3.5 shrink-0 text-primary" />
						)}
					</DropdownMenuItem>
				))}
				{allowCustomPath && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => setCustomMode(true)} className="flex items-center gap-2 text-[12px]">
							<span className="icon-[solar--folder-path-connect-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							{t("projectPicker.customPath")}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
