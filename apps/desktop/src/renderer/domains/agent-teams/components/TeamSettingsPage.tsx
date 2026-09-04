import { confirmDialogAtom } from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import { isBuiltinAgentPreset, listLibraryAgentProfiles, type AgentProfile } from "@vetta/agent-team";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vetta/ui";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyAgentTeamConfigurationChanged } from "../../project/components/sidebar/projects/panel/AgentTeamSidebarList";
import type { AgentProfileEditInput } from "../hooks/useAgentLibraryModel";
import { useAgentTeamSidebarSelection } from "@shared/agent-teams/useAgentTeamSidebarSelection";
import { agentDisplayDescription, agentDisplayName, teamDisplayName } from "@shared/agent-teams/preset-presentation";
import type { AgentTeamConfigurationResources } from "../services/load-agent-team-resources";
import { loadAgentTeamConfigurationResources } from "../services/load-agent-team-resources";
import { AgentProfileEditor } from "./AgentProfileEditor";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";

type TeamMemberDraft =
	| {
			readonly key: string;
			readonly kind: "existing";
			readonly memberId: string;
			readonly profileId: string;
			readonly leader: boolean;
	  }
	| {
			readonly key: string;
			readonly kind: "new";
			readonly agentProfileId: string;
			readonly bindingKind: "reference" | "copy";
			readonly leader: boolean;
	  };

export function TeamSettingsPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	useAgentTeamSidebarSelection();
	const { teamId } = useParams({ from: "/agent-teams/$teamId/settings" });
	const navigate = useNavigate();
	const confirm = useSetAtom(confirmDialogAtom);
	const [resources, setResources] = useState<AgentTeamConfigurationResources>();
	const [name, setName] = useState("");
	const [drafts, setDrafts] = useState<readonly TeamMemberDraft[]>([]);
	const [selectedKey, setSelectedKey] = useState<string>();
	const [addOpen, setAddOpen] = useState(false);
	const [addBindingKind, setAddBindingKind] = useState<"reference" | "copy">("reference");
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string>();
	const [agentDraft, setAgentDraft] = useState<AgentProfileEditInput>();
	const [agentDirty, setAgentDirty] = useState(false);
	const [agentSaving, setAgentSaving] = useState(false);
	const [saveRequest, setSaveRequest] = useState(0);

	const applyResources = useCallback(
		(next: AgentTeamConfigurationResources): void => {
			const nextTeam = next.document.teams.find((candidate) => candidate.id === teamId);
			if (!nextTeam) throw new Error(`Agent team not found: ${teamId}`);
			const nextDrafts = nextTeam.members.map((member) => ({
				key: member.id,
				kind: "existing" as const,
				memberId: member.id,
				profileId: member.binding.agentProfileId,
				leader: member.id === nextTeam.leaderMemberId,
			}));
			setResources(next);
			setName(teamDisplayName(nextTeam, t));
			setDrafts(nextDrafts);
			setSelectedKey((current) =>
				current && nextDrafts.some((draft) => draft.key === current)
					? current
					: (nextDrafts.find((draft) => draft.leader)?.key ?? nextDrafts[0]?.key),
			);
			setDirty(false);
		},
		[t, teamId],
	);

	useEffect(() => {
		let cancelled = false;
		void loadAgentTeamConfigurationResources()
			.then((next) => {
				if (!cancelled) applyResources(next);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(errorMessage(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [applyResources]);

	const team = resources?.document.teams.find((candidate) => candidate.id === teamId);
	const selected = drafts.find((draft) => draft.key === selectedKey);
	const selectedProfile = selected
		? resources?.document.agents.find((agent) =>
				agent.id === (selected.kind === "existing" ? selected.profileId : selected.agentProfileId),
			)
		: undefined;
	const blueprint = resources?.blueprints.find((candidate) => candidate.id === selectedProfile?.blueprintId);

	useEffect(() => {
		setAgentDraft(undefined);
		setAgentDirty(false);
		setAgentSaving(false);
	}, [selectedKey]);

	const handleAgentDraftChange = useCallback(
		(input: AgentProfileEditInput): void => {
			setAgentDraft(input);
			setAgentDirty(selectedProfile ? isAgentDraftDirty(selectedProfile, input) : false);
		},
		[selectedProfile],
	);
	const usedLibraryAgentIds = useMemo(
		() =>
			new Set(
				drafts.flatMap((draft) => {
					if (draft.kind === "new") return [draft.agentProfileId];
					const profile = resources?.document.agents.find((agent) => agent.id === draft.profileId);
					if (!profile) return [];
					return [profile.scope.kind === "library" ? profile.id : (profile.copiedFrom ?? profile.id)];
				}),
		),
		[drafts, resources],
	);
	const availableAgents = useMemo(
		() =>
			resources
				? listLibraryAgentProfiles(resources.document).filter((agent) => !usedLibraryAgentIds.has(agent.id))
				: [],
		[resources, usedLibraryAgentIds],
	);

	function addMember(agent: AgentProfile): void {
		const key = `new:${agent.id}`;
		setDrafts((current) => [
			...current,
			{
				key,
				kind: "new",
				agentProfileId: agent.id,
				bindingKind: addBindingKind,
				leader: current.length === 0,
			},
		]);
		setSelectedKey(key);
		setDirty(true);
		setSaved(false);
		setAddOpen(false);
	}

	function removeMember(key: string): void {
		if (drafts.length <= 1) {
			setError(t("settings.lastMember"));
			return;
		}
		setDrafts((current) => {
			const removed = current.find((draft) => draft.key === key);
			const remaining = current.filter((draft) => draft.key !== key);
			if (!removed?.leader) return remaining;
			return remaining.map((draft, index) => ({ ...draft, leader: index === 0 }));
		});
		if (selectedKey === key) setSelectedKey(drafts.find((draft) => draft.key !== key)?.key);
		setDirty(true);
		setSaved(false);
		setError(undefined);
	}

	function makeLeader(key: string): void {
		setDrafts((current) => current.map((draft) => ({ ...draft, leader: draft.key === key })));
		setDirty(true);
		setSaved(false);
	}

	async function saveTeamDraft(): Promise<void> {
		if (!team || !name.trim() || drafts.length === 0) return;
		const updated = await window.vetta.agentTeams.updateTeam(team.id, {
			expectedRevision: team.revision,
			name: name.trim(),
			description: team.description,
			members: drafts.map((draft) =>
				draft.kind === "existing"
					? { kind: "existing" as const, memberId: draft.memberId, leader: draft.leader }
					: {
							kind: "new" as const,
							agentProfileId: draft.agentProfileId,
							bindingKind: draft.bindingKind,
							leader: draft.leader,
						},
			),
		});
		setResources((current) =>
			current
				? {
						...current,
						document: {
							...current.document,
							teams: current.document.teams.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
						},
					}
				: current,
		);
		setDirty(false);
		notifyAgentTeamConfigurationChanged();
	}

	async function saveAll(): Promise<void> {
		if (!team || !name.trim() || drafts.length === 0 || (!dirty && !agentDirty)) return;
		setSaving(true);
		setError(undefined);
		setSaved(false);
		try {
			if (dirty) await saveTeamDraft();
			if (agentDirty && selectedProfile && agentDraft) setSaveRequest((current) => current + 1);
			if (!agentDirty) setSaved(true);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setSaving(false);
		}
	}

	async function saveAgent(agent: AgentProfile, input: AgentProfileEditInput) {
		const updated = await window.vetta.agentTeams.updateAgent(agent.id, {
			expectedRevision: agent.revision,
			name: input.name,
			description: input.description,
			avatar: input.avatar,
			mentionHandle: input.mentionHandle,
			abilities: input.abilities,
		});
		setResources((current) =>
			current
				? {
						...current,
						document: {
							...current.document,
							agents: current.document.agents.map((candidate) =>
								candidate.id === updated.id ? updated : candidate,
							),
						},
					}
				: current,
		);
		notifyAgentTeamConfigurationChanged();
		return { updated, impact: await window.vetta.agentTeams.previewAgentUpdate(agent.id) };
	}

	function requestDeleteTeam(): void {
		if (!team) return;
		confirm({
			title: t("settings.deleteTeamTitle"),
			message: t("settings.deleteTeamMessage", { name: teamDisplayName(team, t) }),
			confirmLabel: t("settings.deleteTeam"),
			variant: "danger",
			onConfirm: () => {
				void window.vetta.agentTeams
					.deleteTeam(team.id, { expectedRevision: team.revision })
					.then(() => {
						notifyAgentTeamConfigurationChanged();
						void navigate({ to: "/agent-teams" });
					})
					.catch((cause: unknown) => setError(errorMessage(cause)));
			},
		});
	}

	if (error && !resources) {
		return <div className="m-8 text-sm text-destructive">{t("error.load", { error })}</div>;
	}
	if (!resources || !team) {
		return <div className="p-8 text-sm text-muted-foreground">{t("loading")}</div>;
	}

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
			<header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border/60 bg-card/20 px-6 py-4">
				<Button
					variant="ghost"
					size="icon-sm"
					className="-ml-2 shrink-0 text-muted-foreground"
					aria-label={t("settings.backToChat")}
					onClick={() => void navigate({ to: "/agent-teams/$teamId", params: { teamId } })}
				>
					<span className="icon-[solar--alt-arrow-left-linear] h-4 w-4" aria-hidden="true" />
				</Button>
				<div className="h-8 w-px shrink-0 bg-border/60" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<div className="text-[11px] font-medium tracking-wide text-muted-foreground">{t("teams.name")}</div>
					<Input
						name="agent-team-name"
						autoComplete="off"
						value={name}
						onChange={(event) => {
							setName(event.target.value);
							setDirty(true);
							setSaved(false);
						}}
						aria-label={t("teams.name")}
						className="mt-0.5 h-9 w-72 max-w-full rounded-md border-transparent bg-muted/30 px-2 text-xl font-semibold shadow-none transition-colors hover:bg-muted/50 focus-visible:border-transparent focus-visible:bg-muted/40 focus-visible:ring-0"
					/>
					<p className="mt-0.5 text-xs text-muted-foreground">{t("settings.subtitle")}</p>
				</div>
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					{error && <span className="max-w-56 text-right text-xs text-destructive">{error}</span>}
					{saved && <span className="text-xs text-muted-foreground">{t("settings.saved")}</span>}
					<Button
						className="min-w-24"
						variant="primary"
						disabled={(!dirty && !agentDirty) || saving || agentSaving || !name.trim()}
						onClick={() => void saveAll()}
					>
						<span className="icon-[solar--diskette-linear] h-4 w-4" aria-hidden="true" />
						{saving || agentSaving ? t("settings.saving") : t("settings.save")}
					</Button>
					<Button variant="ghost" className="gap-1.5 text-destructive" onClick={requestDeleteTeam}>
						<span className="icon-[solar--trash-bin-trash-linear] h-4 w-4" aria-hidden="true" />
						{t("settings.delete")}
					</Button>
				</div>
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)]">
				<aside className="flex min-h-0 flex-col border-r border-border/60 bg-card/10">
					<div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-4">
						<div>
							<div className="text-sm font-semibold tracking-tight">{t("settings.members")}</div>
							<div className="mt-0.5 text-xs text-muted-foreground">{t("teams.memberCount", { count: drafts.length })}</div>
						</div>
						<Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
							<span className="icon-[solar--add-circle-linear] h-4 w-4" aria-hidden="true" />
							<span className="sr-only sm:not-sr-only">{t("settings.addMember")}</span>
						</Button>
					</div>
					<div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
						{drafts.map((draft) => {
							const profile = resources.document.agents.find(
								(agent) => agent.id === (draft.kind === "existing" ? draft.profileId : draft.agentProfileId),
							);
							const displayName = profile ? agentDisplayName(profile, t) : t("settings.profileMissing");
							return (
								<div
									key={draft.key}
									className={[
										"group flex items-center gap-2 rounded-lg px-2 py-2.5 transition-colors",
										selectedKey === draft.key ? "bg-muted/80 ring-1 ring-border/70" : "hover:bg-muted/40",
									].join(" ")}
								>
									<button
										type="button"
										aria-label={displayName}
										className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
										onClick={() => setSelectedKey(draft.key)}
									>
										<AgentAvatarView
											name={displayName}
											avatar={profile ? agentAvatarUrl(profile) : undefined}
											blueprintId={profile?.blueprintId}
											size="md"
										/>
										<span className="min-w-0 flex-1 truncate text-sm font-medium">{displayName}</span>
									</button>
									{draft.leader ? (
											<span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
												{t("settings.leader")}
											</span>
									) : (
										<Button variant="ghost" size="icon-xs" onClick={() => makeLeader(draft.key)}>
											<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
											<span className="sr-only">{t("settings.makeLeader", { name: displayName })}</span>
										</Button>
									)}
									<Button variant="ghost" size="icon-xs" onClick={() => removeMember(draft.key)}>
										<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
										<span className="sr-only">{t("teams.removeMember", { name: displayName })}</span>
									</Button>
								</div>
							);
						})}
					</div>
				</aside>

				<main className="min-w-0 overflow-y-auto px-6 py-8 lg:px-10">
					{selected?.kind === "new" ? (
						<div className="mx-auto max-w-3xl rounded-xl border border-border/60 bg-card/30 p-5">
							<h2 className="text-sm font-semibold">{selectedProfile ? agentDisplayName(selectedProfile, t) : ""}</h2>
							<p className="mt-1 text-sm text-muted-foreground">{t("settings.saveBeforeEditing")}</p>
						</div>
					) : selectedProfile ? (
						<AgentProfileEditor
							agent={selectedProfile}
							displayName={agentDisplayName(selectedProfile, t)}
							displayDescription={agentDisplayDescription(selectedProfile, t)}
							identityReadOnly={isBuiltinAgentPreset(selectedProfile)}
							blueprint={blueprint}
							capabilities={resources.capabilities}
							hideSaveAction
							saveRequest={saveRequest}
							onDraftChange={handleAgentDraftChange}
							onSavingChange={setAgentSaving}
							onSaveComplete={() => setSaved(true)}
							onPreview={(agentId) => window.vetta.agentTeams.previewAgentUpdate(agentId)}
							onSave={saveAgent}
						/>
					) : (
						<div className="text-sm text-destructive">{t("settings.profileMissing")}</div>
					)}
				</main>
			</div>

			<Dialog open={addOpen} onOpenChange={setAddOpen}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>{t("settings.addMemberTitle")}</DialogTitle>
						<DialogDescription>{t("settings.addMemberDescription")}</DialogDescription>
					</DialogHeader>
					<Select value={addBindingKind} onValueChange={(value) => setAddBindingKind(value as "reference" | "copy")}>
						<SelectTrigger aria-label={t("teams.bindingType")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="reference">{t("settings.followLibrary")}</SelectItem>
							<SelectItem value="copy">{t("settings.teamOnly")}</SelectItem>
						</SelectContent>
					</Select>
					<div className="max-h-80 space-y-1 overflow-y-auto">
						{availableAgents.length ? (
							availableAgents.map((agent) => (
								<div key={agent.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
									<AgentAvatarView
										name={agentDisplayName(agent, t)}
										avatar={agentAvatarUrl(agent)}
										blueprintId={agent.blueprintId}
										size="md"
									/>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">{agentDisplayName(agent, t)}</div>
										<div className="truncate text-xs text-muted-foreground">{agentDisplayDescription(agent, t)}</div>
									</div>
									<Button variant="outline" size="sm" onClick={() => addMember(agent)}>
										{t("settings.add")}
									</Button>
								</div>
							))
						) : (
							<p className="py-8 text-center text-sm text-muted-foreground">{t("settings.noAvailableAgents")}</p>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function isAgentDraftDirty(agent: AgentProfile, input: AgentProfileEditInput): boolean {
	return (
		input.name !== agent.name ||
		input.description !== agent.description ||
		input.avatar !== agentAvatarUrl(agent) ||
		input.mentionHandle !== agent.mentionHandle ||
		JSON.stringify(input.abilities) !== JSON.stringify(agent.abilities)
	);
}
