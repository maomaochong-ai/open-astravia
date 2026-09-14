import type { JSX } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@vetta-org/ui";
import { SkillTypeIcon } from "./skill-icon";

export type SkillDetailTypeView = "scene" | "skill";

export interface SkillDetailDialogSkillView {
	readonly name: string;
	readonly alias?: string | null;
	readonly type: SkillDetailTypeView;
	/** 空=默认；solar:xxx-bold；或已解析图片 URL */
	readonly icon?: string | null;
	readonly version?: string | null;
	readonly author?: string | null;
	readonly downloadCount?: number | null;
	readonly tags?: readonly string[] | null;
	readonly description?: string | null;
	readonly license?: string | null;
}

export interface SkillDetailDialogViewLabels {
	readonly typeLabel: string;
	readonly typeNoun: string;
	readonly nameLabel: string;
	readonly versionLabel: string;
	readonly authorLabel: string;
	readonly downloadsLabel: string;
	readonly descriptionLabel: string;
	readonly notInstalledHint: string;
}

export interface SkillDetailDialogViewProps {
	readonly skill: SkillDetailDialogSkillView;
	readonly onClose: () => void;
	readonly labels: SkillDetailDialogViewLabels;
	readonly showNotInstalledHint?: boolean;
}

export function SkillDetailDialogView({
	skill,
	onClose,
	labels,
	showNotInstalledHint = true,
}: SkillDetailDialogViewProps): JSX.Element {
	return (
		<Dialog
			open={true}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2.5 text-lg font-bold">
						<span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
							<SkillTypeIcon type={skill.type} icon={skill.icon} className="h-4 w-4" />
						</span>
						<span className="min-w-0 truncate">{skill.alias || skill.name}</span>
					</DialogTitle>
				</DialogHeader>
				<div className="mt-2 space-y-4 text-sm">
					{skill.alias && skill.alias !== skill.name && (
						<div className="rounded-lg bg-muted/50 px-3 py-2">
							<span className="text-muted-foreground">{labels.nameLabel}: </span>
							<span className="font-mono text-[13px]">{skill.name}</span>
						</div>
					)}

					<div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/30 px-3 py-3">
						<div>
							<span className="text-muted-foreground">{labels.typeLabel}</span>
							<p className="font-medium">{labels.typeNoun}</p>
						</div>
						{skill.version && (
							<div>
								<span className="text-muted-foreground">{labels.versionLabel}</span>
								<p className="font-medium">{skill.version}</p>
							</div>
						)}
						{skill.author && (
							<div>
								<span className="text-muted-foreground">{labels.authorLabel}</span>
								<p className="font-medium">{skill.author}</p>
							</div>
						)}
						{skill.downloadCount != null && (
							<div>
								<span className="text-muted-foreground">{labels.downloadsLabel}</span>
								<p className="font-medium">{skill.downloadCount.toLocaleString()}</p>
							</div>
						)}
					</div>

					{skill.tags && skill.tags.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{skill.tags.map((tag) => (
								<span
									key={tag}
									className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] text-primary/80"
								>
									{tag}
								</span>
							))}
						</div>
					)}

					{skill.description && (
						<div>
							<h4 className="mb-1.5 text-[13px] font-semibold text-foreground/70">
								{labels.descriptionLabel}
							</h4>
							<p className="leading-relaxed text-muted-foreground whitespace-pre-line">
								{skill.description}
							</p>
						</div>
					)}

					{skill.type === "skill" && (
						<>
							{skill.license && (
								<div className="flex items-center gap-1 text-muted-foreground/60">
									<span className="icon-[mdi--scale-balance] h-3.5 w-3.5" />
									<span className="text-[12px]">{skill.license}</span>
								</div>
							)}

							{showNotInstalledHint && (
								<div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 px-3 py-2.5 text-[12px] text-muted-foreground/60">
									<p>{labels.notInstalledHint}</p>
								</div>
							)}
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
