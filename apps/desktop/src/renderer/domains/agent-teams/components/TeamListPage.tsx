import {
	type AgentProfile,
	type AgentTeamDocument,
	type CreateTeamMemberInput,
	listLibraryAgentProfiles,
} from "@vetta/agent-team";
import { useNavigate } from "@tanstack/react-router";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import {
	Button,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vetta/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyAgentTeamConfigurationChanged } from "../../project/components/sidebar/projects/panel/AgentTeamSidebarList";
import { useAgentTeamSidebarSelection } from "../hooks/useAgentTeamSidebarSelection";
import { agentDisplayDescription, agentDisplayName, teamDisplayName } from "../lib/preset-presentation";

interface MemberDraft {
	readonly handle: string;
	readonly bindingKind: "reference" | "copy";
	readonly leader: boolean;
}

export function TeamListPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	useAgentTeamSidebarSelection();
	const navigate = useNavigate();
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [name, setName] = useState("");
	const [selected, setSelected] = useState<Record<string, MemberDraft>>({});
	const [error, setError] = useState<string>();

	useEffect(() => {
		void window.vetta.agentTeams
			.list()
			.then((next) => {
				setDocument(next);
				const first = listLibraryAgentProfiles(next)[0];
				if (first) {
					setSelected({
						[first.id]: {
							handle: first.mentionHandle,
							bindingKind: "reference",
							leader: true,
						},
					});
				}
			})
			.catch((cause: unknown) => setError(errorMessage(cause)));
	}, []);

	const selectedAgents = useMemo(
		() => (document ? listLibraryAgentProfiles(document).filter((agent) => selected[agent.id]) : []),
		[document, selected],
	);

	function toggle(agent: AgentProfile): void {
		setSelected((current) => {
			if (current[agent.id]) {
				const next = { ...current };
				delete next[agent.id];
				if (current[agent.id].leader) {
					const replacement = Object.keys(next)[0];
					if (replacement) next[replacement] = { ...next[replacement], leader: true };
				}
				return next;
			}

			const hasLeader = Object.values(current).some((member) => member.leader);
			return {
				...current,
				[agent.id]: {
					handle: agent.mentionHandle,
					bindingKind: "reference",
					leader: !hasLeader,
				},
			};
		});
	}

	function updateMember(agentId: string, update: Partial<MemberDraft>): void {
		setSelected((current) => ({
			...current,
			[agentId]: { ...current[agentId], ...update },
		}));
	}

	function makeLeader(agentId: string): void {
		setSelected((current) => {
			const next: Record<string, MemberDraft> = {};
			for (const [id, member] of Object.entries(current)) {
				next[id] = { ...member, leader: id === agentId };
			}
			return next;
		});
	}

	async function create(): Promise<void> {
		if (!document || !name.trim() || selectedAgents.length === 0) return;
		setError(undefined);
		try {
			const members: CreateTeamMemberInput[] = selectedAgents.map((agent) => ({
				agentProfileId: agent.id,
				...selected[agent.id],
			}));
			const team = await window.vetta.agentTeams.createTeam({
				name: name.trim(),
				members,
			});
			notifyAgentTeamConfigurationChanged();
			void navigate({ to: "/agent-teams/$teamId", params: { teamId: team.id } });
		} catch (cause) {
			setError(errorMessage(cause));
		}
	}

	return (
		<div className="h-full min-w-0 flex-1 overflow-y-auto p-8">
			<div className="mx-auto max-w-4xl">
				<header className="mb-8">
					<h1 className="text-2xl font-bold">{t("teams.title")}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{t("teams.subtitle")}</p>
				</header>

				<section className="rounded-xl border border-border/70 bg-card/30 p-5">
					<label className="block text-sm">
						<span className="mb-1 block text-muted-foreground">{t("teams.name")}</span>
						<Input
							name="agent-team-name"
							autoComplete="off"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={t("teams.namePlaceholder")}
							className="h-9"
						/>
					</label>

					<h2 className="mt-6 text-sm font-semibold">{t("teams.members")}</h2>
					<div className="mt-2 grid gap-2 sm:grid-cols-2">
						{(document ? listLibraryAgentProfiles(document) : []).map((agent) => (
							<MemberDraftRow
								key={agent.id}
								agent={agent}
								draft={selected[agent.id]}
								onToggle={() => toggle(agent)}
								onChange={(update) => updateMember(agent.id, update)}
								onMakeLeader={() => makeLeader(agent.id)}
								displayName={agentDisplayName(agent, t)}
							/>
						))}
					</div>

					<div className="mt-5 flex items-center gap-3">
						<Button
							variant="primary"
							disabled={!name.trim() || selectedAgents.length === 0}
							onClick={() => void create()}
						>
							{t("teams.create")}
						</Button>
						{error && <span className="text-xs text-destructive">{error}</span>}
					</div>
				</section>

				<div className="mt-6 space-y-2">
					{document?.teams.map((team) => (
						<button
							key={team.id}
							type="button"
							onClick={() =>
								void navigate({
									to: "/agent-teams/$teamId",
									params: { teamId: team.id },
								})
							}
							className="block w-full rounded-lg border border-border/60 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/30"
						>
							<div className="text-sm font-medium">{teamDisplayName(team, t)}</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{t("teams.memberCount", { count: team.members.length })}
							</div>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

function MemberDraftRow({
	agent,
	draft,
	displayName,
	onToggle,
	onChange,
	onMakeLeader,
}: {
	readonly agent: AgentProfile;
	readonly draft?: MemberDraft;
	readonly displayName: string;
	readonly onToggle: () => void;
	readonly onChange: (update: Partial<MemberDraft>) => void;
	readonly onMakeLeader: () => void;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<div
			className={`flex items-center gap-3 rounded-lg border p-3 ${
				draft ? "border-primary/40 bg-primary/5" : "border-border"
			}`}
		>
			<AgentAvatarView name={displayName} avatar={agent.avatar} blueprintId={agent.blueprintId} />
			<Button
				variant={draft ? "primary" : "ghost"}
				size="icon-sm"
				aria-label={
					draft
						? t("teams.removeMember", { name: displayName })
						: t("teams.addMember", { name: displayName })
				}
				onClick={onToggle}
			>
				<span
					className={draft ? "icon-[solar--check-circle-bold] h-4 w-4" : "icon-[solar--add-circle-linear] h-4 w-4"}
					aria-hidden="true"
				/>
			</Button>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium">{displayName}</div>
				{agentDisplayDescription(agent, t) && (
					<div className="line-clamp-1 text-xs text-muted-foreground">{agentDisplayDescription(agent, t)}</div>
				)}
			</div>
			{draft && (
				<div className="flex items-center gap-2">
					<Select
						value={draft.bindingKind}
						onValueChange={(value) =>
							onChange({ bindingKind: value as MemberDraft["bindingKind"] })
						}
					>
						<SelectTrigger className="h-8 w-24 text-xs" aria-label={t("teams.bindingType")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="reference">{t("teams.reference")}</SelectItem>
							<SelectItem value="copy">{t("teams.copy")}</SelectItem>
						</SelectContent>
					</Select>
					<Button
						variant={draft.leader ? "secondary" : "ghost"}
						size="sm"
						disabled={draft.leader}
						onClick={onMakeLeader}
					>
						<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
						{t("teams.leader")}
					</Button>
				</div>
			)}
		</div>
	);
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
