import type { AgentProfile } from "@vetta/agent-team";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import { Button, Input } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import type { TeamAssemblyDraft } from "../../lib/team-assembly";
import { AgentAvatarStack } from "./AgentAvatarStack";

export interface TeamAssemblyBarProps {
	readonly draft: TeamAssemblyDraft;
	readonly members: readonly AgentProfile[];
	readonly leaderId?: string;
	readonly onRename: (name: string) => void;
	readonly onPromoteLeader: (agentId: string) => void;
	readonly onRemoveMember: (agent: AgentProfile) => void;
}

/** 拉拢协作栏：只在组队模式下出现，负责团队名、阵容与队长归属。 */
export function TeamAssemblyBar({
	draft,
	members,
	leaderId,
	onRename,
	onPromoteLeader,
	onRemoveMember,
}: TeamAssemblyBarProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<div className="mb-8 flex flex-col gap-3.5 rounded-xl border border-primary/30 bg-card/60 p-4">
			<div className="flex flex-col gap-3.5 sm:flex-row sm:items-center">
				<AgentAvatarStack agents={members} leaderId={leaderId} emptyIcon />
				<div className="min-w-0 flex-1">
					<p className="text-[12px] font-medium text-foreground">{t("center.assemblyTitle")}</p>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						{members.length === 0
							? t("center.assemblyRosterEmpty")
							: t("center.assemblyRoster", { names: members.map((member) => member.name).join("、") })}
					</p>
				</div>
				<Input
					name="agent-team-assembly-name"
					autoComplete="off"
					value={draft.name}
					onChange={(event) => onRename(event.target.value)}
					placeholder={t("center.teamNamePlaceholder")}
					aria-label={t("teams.name")}
					className="h-8 w-full rounded-lg text-[12px] sm:w-60"
				/>
			</div>

			{members.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-3">
					{members.map((member) => {
						const isLeader = member.id === leaderId;
						return (
							<span
								key={member.id}
								className={[
									"inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-1.5 text-[11px]",
									isLeader ? "border-primary/40 bg-primary/10 text-primary" : "border-border/50 text-foreground",
								].join(" ")}
							>
								<AgentAvatarView
									name={member.name}
									avatar={agentAvatarUrl(member)}
									blueprintId={member.blueprintId}
									size="sm"
								/>
								<span className="max-w-24 truncate">{member.name}</span>
								<Button
									variant="ghost"
									size="icon-xs"
									className={`h-5 w-5 rounded-full ${isLeader ? "text-primary" : "text-muted-foreground/60 hover:text-primary"}`}
									disabled={isLeader}
									title={isLeader ? t("center.leader") : t("center.makeLeader")}
									onClick={() => onPromoteLeader(member.id)}
								>
									<span
										className={
											isLeader
												? "icon-[solar--crown-star-bold] h-3 w-3"
												: "icon-[solar--crown-star-linear] h-3 w-3"
										}
										aria-hidden="true"
									/>
									<span className="sr-only">{isLeader ? t("center.leader") : t("center.makeLeader")}</span>
								</Button>
								<Button
									variant="ghost"
									size="icon-xs"
									className="h-5 w-5 rounded-full text-muted-foreground/60 hover:text-destructive"
									title={t("center.dismissAgent")}
									onClick={() => onRemoveMember(member)}
								>
									<span className="icon-[solar--close-circle-linear] h-3 w-3" aria-hidden="true" />
									<span className="sr-only">{t("center.dismissAgent")}</span>
								</Button>
							</span>
						);
					})}
				</div>
			)}
		</div>
	);
}
