import { confirmDialogAtom, pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import { listLibraryAgentProfiles, type AgentProfile } from "@vetta/agent-team";
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
import { agentDisplayDescription, agentDisplayName, teamDisplayName } from "@shared/agent-teams/agent-team-presentation";
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
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
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
			setName(nextTeam.name);
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
	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

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
			systemPrompt: input.systemPrompt,
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
			{/* Top Header */}
			<header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-card/25 backdrop-blur-md px-5">
				{/* Left: Back action + Team Identity */}
				<div className="flex min-w-0 items-center gap-3">
					<Button
						variant="ghost"
						size="icon-xs"
						className="-ml-1 h-8 w-8 shrink-0 rounded-lg text-muted-foreground transition-colors hover:bg-card/80 hover:text-foreground"
						aria-label={t("settings.backToChat")}
						title={t("settings.backToChat")}
						onClick={() => void navigate({ to: "/agent-teams/$teamId", params: { teamId } })}
					>
						<span className="icon-[solar--alt-arrow-left-linear] h-4 w-4" aria-hidden="true" />
					</Button>

					<div className="h-4 w-px shrink-0 bg-border/50" aria-hidden="true" />

					{/* Team Icon */}
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
						<span className="icon-[solar--users-group-rounded-linear] h-4 w-4" aria-hidden="true" />
					</div>

					{/* Inline Editable Team Name */}
					<div className="group relative flex min-w-0 items-center">
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
							className="h-8 w-44 sm:w-56 max-w-full rounded-md border border-transparent bg-transparent px-2 text-base font-bold tracking-tight text-foreground transition-all hover:border-border/60 hover:bg-muted/30 focus-visible:border-primary/50 focus-visible:bg-background/80"
						/>
						<span
							className="icon-[solar--pen-2-linear] pointer-events-none -ml-5 h-3 w-3 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
							aria-hidden="true"
						/>
					</div>

					{/* Member Count Badge */}
					<span className="hidden items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex">
						{t("teams.memberCount", { count: drafts.length })}
					</span>

				</div>

				{/* Right: Status & Actions */}
				<div className="flex items-center gap-2">
					{error && (
						<span className="max-w-48 truncate rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs text-destructive">
							{error}
						</span>
					)}
					{saved && (
						<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							{t("settings.saved")}
						</span>
					)}
					<Button
						size="sm"
						variant="primary"
						className="h-8 gap-1.5 rounded-lg px-3.5 text-xs font-medium"
						disabled={(!dirty && !agentDirty) || saving || agentSaving || !name.trim()}
						onClick={() => void saveAll()}
					>
						<span
							className={[
								"h-3.5 w-3.5",
								saving || agentSaving ? "icon-[solar--spinner-linear] animate-spin" : "icon-[solar--diskette-bold]",
							].join(" ")}
							aria-hidden="true"
						/>
						<span>{saving || agentSaving ? t("settings.saving") : t("settings.save")}</span>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
						onClick={requestDeleteTeam}
					>
						<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
						<span>{t("settings.delete")}</span>
					</Button>
				</div>
			</header>

			{/* Main Workspace Layout */}
			<div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] lg:grid-cols-[22rem_minmax(0,1fr)] bg-background/50">
				{/* Left Sidebar: Roster */}
				<aside className="flex min-h-0 flex-col border-r border-border/50 bg-card/15 backdrop-blur-sm">
					<div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3.5">
						<div className="flex items-center gap-2">
							<span className="text-sm font-semibold tracking-tight text-foreground">{t("settings.members")}</span>
							<span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
								{drafts.length}
							</span>
						</div>
						<Button
							variant="outline"
							size="sm"
							className="h-8 gap-1.5 rounded-lg border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-colors"
							onClick={() => setAddOpen(true)}
						>
							<span className="icon-[solar--user-plus-linear] h-3.5 w-3.5 text-primary" aria-hidden="true" />
							<span className="sr-only sm:not-sr-only text-xs font-medium">{t("settings.addMember")}</span>
						</Button>
					</div>
					<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
						{drafts.map((draft) => {
							const profile = resources.document.agents.find(
								(agent) => agent.id === (draft.kind === "existing" ? draft.profileId : draft.agentProfileId),
							);
							const displayName = profile ? agentDisplayName(profile, t) : t("settings.profileMissing");
							const description = profile ? agentDisplayDescription(profile, t) : "";
							const isSelected = selectedKey === draft.key;
							return (
								<div
									key={draft.key}
									className={[
										"group relative flex items-center gap-2.5 rounded-xl p-2.5 transition-all duration-200",
										isSelected
											? "border border-primary bg-card"
											: "border border-border/40 bg-card/25 hover:border-border/80 hover:bg-card/60",
									].join(" ")}
								>
									{isSelected && (
										<div className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r bg-primary" aria-hidden="true" />
									)}
									<button
										type="button"
										aria-label={displayName}
										className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
										onClick={() => setSelectedKey(draft.key)}
									>
										<AgentAvatarView
											name={displayName}
											avatar={profile ? agentAvatarUrl(profile) : undefined}
											blueprintId={profile?.blueprintId}
											size="md"
										/>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-1.5">
												<span className={`truncate text-sm font-medium ${isSelected ? "text-foreground font-semibold" : "text-foreground/90"}`}>
													{displayName}
												</span>
												{draft.leader && (
													<span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-medium text-amber-400">
														<span className="icon-[solar--crown-bold] h-2.5 w-2.5" aria-hidden="true" />
														{t("settings.leader")}
													</span>
												)}
											</div>
											{description && (
												<p className="mt-0.5 truncate text-xs text-muted-foreground/70">
													{description}
												</p>
											)}
										</div>
									</button>
									<div className="flex shrink-0 items-center gap-0.5">
										{!draft.leader && (
											<Button
												variant="ghost"
												size="icon-xs"
												className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
												onClick={() => makeLeader(draft.key)}
												title={t("settings.makeLeader", { name: displayName })}
											>
												<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
												<span className="sr-only">{t("settings.makeLeader", { name: displayName })}</span>
											</Button>
										)}
										<Button
											variant="ghost"
											size="icon-xs"
											className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
											onClick={() => removeMember(draft.key)}
											title={t("teams.removeMember", { name: displayName })}
										>
											<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
											<span className="sr-only">{t("teams.removeMember", { name: displayName })}</span>
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				</aside>

				{/* Right Main Editor */}
				<main className="min-w-0 overflow-y-auto px-6 py-6 lg:px-10 lg:py-8">
					{selected?.kind === "new" ? (
						<div className="mx-auto max-w-4xl rounded-2xl border border-primary/30 bg-primary/5 p-6 backdrop-blur-sm">
							<div className="flex items-start gap-3.5">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
									<span className="icon-[solar--info-square-linear] h-5 w-5" aria-hidden="true" />
								</div>
								<div>
									<h2 className="text-base font-semibold text-foreground">
										{selectedProfile ? agentDisplayName(selectedProfile, t) : ""}
									</h2>
									<p className="mt-1 text-sm text-muted-foreground/80">{t("settings.saveBeforeEditing")}</p>
								</div>
							</div>
						</div>
					) : selectedProfile ? (
						<AgentProfileEditor
							agent={selectedProfile}
							displayName={agentDisplayName(selectedProfile, t)}
							displayDescription={agentDisplayDescription(selectedProfile, t)}
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

			{/* Add Member Dialog */}
			<Dialog open={addOpen} onOpenChange={setAddOpen}>
				<DialogContent className="max-w-lg rounded-2xl">
					<DialogHeader>
						<DialogTitle className="text-base font-semibold">{t("settings.addMemberTitle")}</DialogTitle>
						<DialogDescription className="text-xs text-muted-foreground">{t("settings.addMemberDescription")}</DialogDescription>
					</DialogHeader>
					<Select value={addBindingKind} onValueChange={(value) => setAddBindingKind(value as "reference" | "copy")}>
						<SelectTrigger aria-label={t("teams.bindingType")} className="h-9.5 rounded-xl">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="rounded-xl">
							<SelectItem value="reference">{t("settings.followLibrary")}</SelectItem>
							<SelectItem value="copy">{t("settings.teamOnly")}</SelectItem>
						</SelectContent>
					</Select>
					<div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
						{availableAgents.length ? (
							availableAgents.map((agent) => (
								<div
									key={agent.id}
									className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 p-2.5 transition-colors hover:border-border hover:bg-card/70"
								>
									<AgentAvatarView
										name={agentDisplayName(agent, t)}
										avatar={agentAvatarUrl(agent)}
										blueprintId={agent.blueprintId}
										size="md"
									/>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium text-foreground">{agentDisplayName(agent, t)}</div>
										<div className="truncate text-xs text-muted-foreground/80">{agentDisplayDescription(agent, t)}</div>
									</div>
									<Button variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={() => addMember(agent)}>
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
		(input.systemPrompt ?? "") !== (agent.systemPrompt ?? "") ||
		input.avatar !== agentAvatarUrl(agent) ||
		input.mentionHandle !== agent.mentionHandle ||
		JSON.stringify(input.abilities) !== JSON.stringify(agent.abilities)
	);
}
