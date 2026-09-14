import type { JSX } from "react";
import { Button } from "@vetta-org/ui";
import { SettingSection, type SettingSectionMeta } from "./SettingChrome";

export interface ArchivedProjectRowView {
	readonly path: string;
	readonly name: string;
}

export interface ArchivedProjectsSettingsViewLabels {
	readonly title: string;
	readonly empty: string;
	readonly sectionTitle: string;
	readonly unarchive: string;
	readonly deleteProject: string;
}

export interface ArchivedProjectsSettingsViewProps {
	readonly labels: ArchivedProjectsSettingsViewLabels;
	readonly projects: readonly ArchivedProjectRowView[];
	readonly section: SettingSectionMeta;
	readonly onUnarchive: (path: string) => void;
	readonly onDelete: (path: string) => void;
}

export function ArchivedProjectsSettingsView({
	labels,
	projects,
	section,
	onUnarchive,
	onDelete,
}: ArchivedProjectsSettingsViewProps): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<h1 className="mb-6 text-[20px] font-bold text-foreground">{labels.title}</h1>

			{projects.length === 0 ? (
				<div className="flex flex-col items-center gap-2.5 py-16 text-center">
					<span className="icon-[mdi--archive-off-outline] h-8 w-8 text-muted-foreground" />
					<p className="text-[13px] text-muted-foreground">{labels.empty}</p>
				</div>
			) : (
				<SettingSection title={labels.sectionTitle} section={section}>
					{projects.map((entry) => (
						<div
							key={entry.path}
							className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0"
						>
							<span className="icon-[mdi--folder-outline] h-4 w-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<div className="text-[13px] font-medium text-foreground">{entry.name}</div>
								<div className="mt-0.5 truncate text-[11px] text-muted-foreground">{entry.path}</div>
							</div>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="xs"
									onClick={() => onUnarchive(entry.path)}
									title={labels.unarchive}
								>
									<span className="icon-[mdi--archive-arrow-up-outline] h-3.5 w-3.5" />
									{labels.unarchive}
								</Button>
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() => onDelete(entry.path)}
									title={labels.deleteProject}
									className="text-muted-foreground hover:text-destructive"
								>
									<span className="icon-[mdi--delete-outline] h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					))}
				</SettingSection>
			)}
		</div>
	);
}
