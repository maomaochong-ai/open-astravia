import type { AgentBlueprint, AgentProfile } from "@vetta/agent-team";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { Button } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { AgentCapabilityOption } from "../lib/capability-options";
import { isAgentAbilitySelected } from "../lib/ability-selection";

export interface TeamMemberCardProps {
	readonly keyId: string;
	readonly profile?: AgentProfile;
	readonly displayName: string;
	readonly description: string;
	readonly isLeader: boolean;
	readonly blueprint?: AgentBlueprint;
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly onSelect: () => void;
	readonly onMakeLeader: () => void;
	readonly onRemove: () => void;
}

export function TeamMemberCard({
	profile,
	displayName,
	description,
	isLeader,
	blueprint,
	capabilities,
	onSelect,
	onMakeLeader,
	onRemove,
}: TeamMemberCardProps): JSX.Element {
	const { t } = useTranslation("agent-teams");

	const selectedAbilitiesCount = profile
		? capabilities.filter((option) => isAgentAbilitySelected(profile.abilities, option)).length
		: 0;

	return (
		<div className="group relative flex flex-col justify-between rounded-2xl border border-border/50 bg-card/35 p-5 transition-all duration-200 hover:border-border/90 hover:bg-card/70">
			{/* Top: Avatar & Leader Badge / Actions */}
			<div className="flex items-start justify-between gap-3">
				<AgentAvatarView
					name={displayName}
					avatar={profile ? agentAvatarUrl(profile) : undefined}
					blueprintId={profile?.blueprintId}
					size="md"
				/>
				<div className="flex items-center gap-1">
					{isLeader ? (
						<span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
							<span className="icon-[solar--crown-bold] h-3 w-3" aria-hidden="true" />
							{t("settings.leader")}
						</span>
					) : (
						<Button
							variant="ghost"
							size="icon-xs"
							className="h-7 w-7 rounded-lg text-muted-foreground/60 transition-colors hover:bg-amber-500/10 hover:text-amber-400"
							onClick={(e) => {
								e.stopPropagation();
								onMakeLeader();
							}}
							title={t("settings.makeLeader", { name: displayName })}
						>
							<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
							<span className="sr-only">{t("settings.makeLeader", { name: displayName })}</span>
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon-xs"
						className="h-7 w-7 rounded-lg text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						title={t("teams.removeMember", { name: displayName })}
					>
						<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
						<span className="sr-only">{t("teams.removeMember", { name: displayName })}</span>
					</Button>
				</div>
			</div>

			{/* Center: Click target for viewing/editing details */}
			<button
				type="button"
				aria-label={displayName}
				onClick={onSelect}
				className="my-3.5 flex flex-1 flex-col text-left outline-none"
			>
				<span className="truncate text-base font-bold text-foreground transition-colors group-hover:text-primary">
					{displayName}
				</span>
				{blueprint && (
					<span className="mt-0.5 inline-block text-xs font-medium text-primary/80">
						{t(blueprint.nameKey as never)}
					</span>
				)}
				<p className="mt-2 min-h-8 text-xs leading-relaxed text-muted-foreground/75 line-clamp-2">
					{description || t("settings.profileMissing")}
				</p>
			</button>

			{/* Footer: Abilities Count & Edit Action */}
			<div className="mt-2 flex items-center justify-between border-t border-border/30 pt-3 text-xs">
				<span className="inline-flex items-center gap-1.5 text-muted-foreground/70">
					<span className="icon-[solar--bolt-circle-linear] h-3.5 w-3.5 text-primary" aria-hidden="true" />
					<span>{t("profile.abilityCount", { selected: selectedAbilitiesCount, total: capabilities.length })}</span>
				</span>
				<button
					type="button"
					onClick={onSelect}
					className="inline-flex items-center gap-0.5 font-medium text-primary transition-transform group-hover:translate-x-0.5"
				>
					<span>{t("settings.editMember")}</span>
					<span className="icon-[solar--alt-arrow-right-linear] h-3 w-3" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}
