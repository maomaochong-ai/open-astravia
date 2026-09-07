import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { AgentProfile, TeamDefinition, TeamMemberAssignment } from "@vetta/agent-team";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { DetailDrawer, DetailDrawerEnter } from "@vetta/theme-ui/overlays";
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
	cn,
} from "@vetta/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type TeamAssemblyDraft,
	assemblyAssignment,
	assemblyDraftFromTeam,
	assemblyLeaderId,
	canSubmitAssembly,
	setAssemblyAssignment,
	toggleAssemblyMember,
} from "../lib/team-assembly";

export interface TeamSettingsSheetProps {
	readonly open: boolean;
	readonly team: TeamDefinition;
	readonly agents: readonly AgentProfile[];
	readonly agentsById: ReadonlyMap<string, AgentProfile>;
	readonly onClose: () => void;
	readonly onExited?: () => void;
	readonly onSave: (draft: TeamAssemblyDraft) => Promise<TeamDefinition | undefined>;
	readonly onDelete: () => void;
	/** 打开某位成员的档案抽屉，让能力配置回到同一套编辑入口。 */
	readonly onOpenMember: (agentId: string) => void;
}

/** 团队设置抽屉：与智能体档案、能力详情共用同一枚抽屉壳。 */
export function TeamSettingsSheet({
	open,
	team,
	agents,
	agentsById,
	onClose,
	onExited,
	onSave,
	onDelete,
	onOpenMember,
}: TeamSettingsSheetProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const [draft, setDraft] = useState<TeamAssemblyDraft>(() => assemblyDraftFromTeam(team));
	const [addOpen, setAddOpen] = useState(false);
	const [addBindingKind, setAddBindingKind] = useState<"reference" | "copy">("reference");
	/** 正在展开任务书编辑区的成员（Agent 身份）；任务书随团队一起保存，不单独落盘。 */
	const [assignmentAgentId, setAssignmentAgentId] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();

	// 团队被外部保存（改名、拉拢成员）后重新起草，避免抽屉里留着旧修订。
	useEffect(() => setDraft(assemblyDraftFromTeam(team)), [team]);

	const leaderId = assemblyLeaderId(draft);
	const members = draft.memberIds
		.map((id) => agentsById.get(id))
		.filter((agent): agent is AgentProfile => Boolean(agent));
	const availableAgents = agents.filter((agent) => !draft.memberIds.includes(agent.id));
	const dirty = !sameDraft(draft, assemblyDraftFromTeam(team));

	function toggleMember(agentId: string): void {
		if (draft.memberIds.length <= 1 && draft.memberIds.includes(agentId)) {
			setError(t("settings.lastMember"));
			return;
		}
		setError(undefined);
		setDraft((current) => toggleAssemblyMember(current, agentId));
	}

	function addMember(agent: AgentProfile): void {
		setDraft((current) => ({
			...toggleAssemblyMember(current, agent.id),
			bindingKinds: { ...current.bindingKinds, [agent.id]: addBindingKind },
		}));
		setAddOpen(false);
	}

	async function save(): Promise<void> {
		if (!canSubmitAssembly(draft)) return;
		setSaving(true);
		setError(undefined);
		const saved = await onSave(draft);
		setSaving(false);
		if (saved) onClose();
	}

	return (
		<DetailDrawer
			open={open}
			title={draft.name || team.name}
			description={draft.description ?? team.description}
			onClose={onClose}
			onExited={onExited}
		>
			<div className="relative h-full overflow-hidden">
				<div className="absolute inset-0 overflow-y-auto overflow-x-hidden px-5 pb-8 pt-8">
					<div className="flex w-full flex-col gap-8">
						<DetailDrawerEnter index={0}>
							<div className="flex flex-col gap-4">
								<div className="flex items-start gap-4">
									<span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
										<span className="icon-[solar--users-group-rounded-linear] h-7 w-7" aria-hidden="true" />
									</span>
									<div className="min-w-0 flex-1">
										<h1 className="truncate text-[20px] font-semibold leading-snug tracking-tight text-foreground">
											{draft.name || team.name}
										</h1>
										<p className="mt-1.5 text-[11px] text-muted-foreground/70">
											{t("teams.memberCount", { count: members.length })}
										</p>
									</div>
								</div>

								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="primary"
										size="lg"
										className="min-w-40 flex-1"
										disabled={saving || !dirty || !canSubmitAssembly(draft)}
										onClick={() => void save()}
									>
										<span
											className={cn(
												"h-4 w-4",
												saving ? "icon-[solar--refresh-linear] animate-spin" : "icon-[solar--diskette-linear]",
											)}
											aria-hidden="true"
										/>
										{saving ? t("settings.saving") : t("settings.saveChanges")}
									</Button>
									<Button
										variant="outline"
										size="lg"
										className="text-muted-foreground hover:text-destructive"
										title={t("settings.deleteTeam")}
										aria-label={t("settings.deleteTeam")}
										onClick={onDelete}
									>
										<span className="icon-[solar--trash-bin-trash-linear] h-4 w-4" aria-hidden="true" />
									</Button>
								</div>

								{error && (
									<p aria-live="polite" className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
										{error}
									</p>
								)}
							</div>
						</DetailDrawerEnter>

						<DetailDrawerEnter index={1} className="flex flex-col gap-4">
							<SectionTitle>{t("settings.identity")}</SectionTitle>
							<label className="flex flex-col gap-1.5">
								<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
									{t("teams.name")}
								</span>
								<Input
									name="agent-team-name"
									autoComplete="off"
									value={draft.name}
									onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
									aria-label={t("teams.name")}
									className="h-9"
								/>
							</label>
							<label className="flex flex-col gap-1.5">
								<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
									{t("settings.description")}
								</span>
								<textarea
									value={draft.description ?? ""}
									onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
									rows={3}
									placeholder={t("settings.descriptionPlaceholder")}
									aria-label={t("settings.description")}
									className="min-h-20 w-full resize-none rounded-xl border border-border/60 bg-background/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-foreground caret-primary outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
								/>
							</label>
						</DetailDrawerEnter>

						<DetailDrawerEnter index={2} className="flex flex-col gap-3">
							<div className="flex items-center justify-between gap-3">
								<SectionTitle>{t("settings.members")}</SectionTitle>
								<Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
									<span className="icon-[solar--user-plus-linear] h-4 w-4" aria-hidden="true" />
									<span className="text-[12px] font-medium">{t("settings.addMember")}</span>
								</Button>
							</div>

							<ul className="flex flex-col gap-1.5">
								{members.map((member) => {
									const isLeader = member.id === leaderId;
									return (
										<li
											key={member.id}
											className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/40 p-2.5 transition-colors hover:border-primary/40 hover:bg-card/60"
										>
											<div className="flex items-center gap-3">
												<AgentAvatarView
													name={member.name}
													avatar={agentAvatarUrl(member)}
													blueprintId={member.blueprintId}
													size="xl"
												/>
												<button
													type="button"
													onClick={() => onOpenMember(member.id)}
													aria-label={member.name}
													className="min-w-0 flex-1 text-left outline-none"
												>
													<span className="flex items-center gap-1.5">
														<span className="truncate text-[13px] font-medium text-foreground">{member.name}</span>
														{isLeader && (
															<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
																<span className="icon-[solar--crown-star-bold] h-3 w-3" aria-hidden="true" />
																{t("settings.leader")}
															</span>
														)}
													</span>
													<span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground/80">
														{member.description}
													</span>
												</button>
												{!isLeader && (
													<Button
														variant="ghost"
														size="icon-sm"
														className="shrink-0 text-muted-foreground/60 hover:text-amber-400"
														title={t("settings.makeLeader", { name: member.name })}
														aria-label={t("settings.makeLeader", { name: member.name })}
														onClick={() => setDraft((current) => ({ ...current, leaderId: member.id }))}
													>
														<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
													</Button>
												)}
												<Button
													variant="ghost"
													size="icon-sm"
													className="shrink-0 text-muted-foreground/60 hover:text-destructive"
													title={t("teams.removeMember", { name: member.name })}
													aria-label={t("teams.removeMember", { name: member.name })}
													onClick={() => toggleMember(member.id)}
												>
													<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
												</Button>
											</div>

											{assignmentAgentId === member.id ? (
												<MemberAssignmentEditor
													agent={member}
													assignment={assemblyAssignment(draft, member.id)}
													onClose={() => setAssignmentAgentId(undefined)}
													onSave={(assignment) => {
														setDraft((current) => setAssemblyAssignment(current, member.id, assignment));
														setAssignmentAgentId(undefined);
													}}
												/>
											) : (
												<MemberAssignmentRow
													agent={member}
													assignment={assemblyAssignment(draft, member.id)}
													onOpen={() => setAssignmentAgentId(member.id)}
												/>
											)}
										</li>
									);
								})}
							</ul>
						</DetailDrawerEnter>
					</div>
				</div>
			</div>

			<Dialog open={addOpen} onOpenChange={setAddOpen}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle className="text-[14px] font-semibold">{t("settings.addMemberTitle")}</DialogTitle>
						<DialogDescription className="text-[12px] text-muted-foreground">
							{t("settings.addMemberDescription")}
						</DialogDescription>
					</DialogHeader>

					<Select value={addBindingKind} onValueChange={(value) => setAddBindingKind(value as "reference" | "copy")}>
						<SelectTrigger aria-label={t("teams.bindingType")} className="h-9">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="reference">{t("settings.followLibrary")}</SelectItem>
							<SelectItem value="copy">{t("settings.teamOnly")}</SelectItem>
						</SelectContent>
					</Select>

					<div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
						{availableAgents.length ? (
							availableAgents.map((agent) => (
								<div
									key={agent.id}
									className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-2.5 transition-colors hover:border-primary/40 hover:bg-card/60"
								>
									<AgentAvatarView
										name={agent.name}
										avatar={agentAvatarUrl(agent)}
										blueprintId={agent.blueprintId}
										size="xl"
									/>
									<div className="min-w-0 flex-1">
										<div className="truncate text-[13px] font-medium text-foreground">{agent.name}</div>
										<div className="truncate text-[11.5px] text-muted-foreground/80">{agent.description}</div>
									</div>
									<Button variant="outline" size="sm" className="shrink-0" onClick={() => addMember(agent)}>
										<span className="text-[12px] font-medium">{t("settings.add")}</span>
									</Button>
								</div>
							))
						) : (
							<p className="py-8 text-center text-[12px] text-muted-foreground">{t("settings.noAvailableAgents")}</p>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</DetailDrawer>
	);
}

/**
 * 折叠态的任务书条目：没设置时是一条摆在明面上的虚线入口，设置了就把团队内那句
 * 摆在本体描述下面并排看。任务书是入团后最常调的东西，不该缩成一排图标里的一枚。
 */
function MemberAssignmentRow({
	agent,
	assignment,
	onOpen,
}: {
	readonly agent: AgentProfile;
	readonly assignment?: TeamMemberAssignment;
	readonly onOpen: () => void;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	if (!assignment) {
		return (
			<button
				type="button"
				aria-label={t("settings.editAssignment", { name: agent.name })}
				onClick={onOpen}
				className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2.5 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
			>
				<span className="icon-[solar--clipboard-add-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				<span className="truncate">{t("settings.assignmentEmpty")}</span>
			</button>
		);
	}
	return (
		<button
			type="button"
			aria-label={t("settings.editAssignment", { name: agent.name })}
			onClick={onOpen}
			className="flex w-full items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/10"
		>
			<span className="icon-[solar--clipboard-text-bold] mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-1.5">
					<span className="text-[11px] font-medium text-primary">{t("settings.assignmentBadge")}</span>
					{assignment.instructions && (
						<span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
							{t("settings.assignmentHasInstructions")}
						</span>
					)}
				</span>
				<span className="mt-0.5 block truncate text-[11.5px] text-foreground/90">
					{assignment.responsibility ?? agent.description}
				</span>
			</span>
			<span className="icon-[solar--pen-2-linear] mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
		</button>
	);
}

/**
 * 任务书编辑：在 Agent 本体的基调上做团队内增量，留空即回到本体。
 *
 * 刻意内联在抽屉里而不是再开一个 Dialog：DetailDrawer 底层是 modal 的 vaul/Radix
 * Content，会 trap focus 并 hideOthers，portal 到 body 的嵌套弹窗里输入框拿不住焦点
 * ——按钮点得动、字打不进去。表单长在抽屉内也与智能体档案抽屉的既有写法一致。
 */
function MemberAssignmentEditor({
	agent,
	assignment,
	onClose,
	onSave,
}: {
	readonly agent: AgentProfile;
	readonly assignment?: TeamMemberAssignment;
	readonly onClose: () => void;
	readonly onSave: (assignment: TeamMemberAssignment) => void;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const [responsibility, setResponsibility] = useState(assignment?.responsibility ?? "");
	const [instructions, setInstructions] = useState(assignment?.instructions ?? "");

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-background/40 p-3">
			<div className="flex flex-col gap-1">
				<h3 className="text-[12.5px] font-semibold text-foreground">
					{t("settings.assignmentTitle", { name: agent.name })}
				</h3>
				<p className="text-[11px] leading-relaxed text-muted-foreground">{t("settings.assignmentDescription")}</p>
			</div>

			<label className="flex flex-col gap-1.5">
					<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
						{t("settings.assignmentResponsibility")}
					</span>
					<Input
						value={responsibility}
						onChange={(event) => setResponsibility(event.target.value)}
						placeholder={agent.description}
						aria-label={t("settings.assignmentResponsibility")}
						className="h-9"
					/>
					<span className="text-[11px] text-muted-foreground/60">{t("settings.assignmentResponsibilityHint")}</span>
				</label>

				<label className="flex flex-col gap-1.5">
					<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
						{t("settings.assignmentInstructions")}
					</span>
					<textarea
						value={instructions}
						onChange={(event) => setInstructions(event.target.value)}
						rows={5}
						placeholder={t("settings.assignmentInstructionsPlaceholder")}
						aria-label={t("settings.assignmentInstructions")}
						className="min-h-28 w-full resize-none rounded-xl border border-border/60 bg-background/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-foreground caret-primary outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
					/>
					<span className="text-[11px] text-muted-foreground/60">{t("settings.assignmentInstructionsHint")}</span>
				</label>

			<div className="flex justify-end gap-2">
				<Button variant="outline" size="sm" onClick={onClose}>
					<span className="text-[12px] font-medium">{t("settings.assignmentCancel")}</span>
				</Button>
				<Button variant="primary" size="sm" onClick={() => onSave({ responsibility, instructions })}>
					<span className="text-[12px] font-medium">{t("settings.assignmentApply")}</span>
				</Button>
			</div>
		</div>
	);
}

function SectionTitle({ children }: { readonly children: string }): JSX.Element {
	return (
		<div className="flex items-center gap-3">
			<h2 className="text-[15px] font-semibold tracking-tight text-foreground">{children}</h2>
			<span className="h-px min-w-4 flex-1 bg-border/40" aria-hidden="true" />
		</div>
	);
}

function sameDraft(left: TeamAssemblyDraft, right: TeamAssemblyDraft): boolean {
	return (
		left.name === right.name &&
		(left.description ?? "") === (right.description ?? "") &&
		left.leaderId === right.leaderId &&
		left.memberIds.length === right.memberIds.length &&
		left.memberIds.every((id, index) => id === right.memberIds[index]) &&
		sameAssignments(left, right)
	);
}

function sameAssignments(left: TeamAssemblyDraft, right: TeamAssemblyDraft): boolean {
	const ids = new Set([...Object.keys(left.assignments ?? {}), ...Object.keys(right.assignments ?? {})]);
	for (const id of ids) {
		const first = left.assignments?.[id];
		const second = right.assignments?.[id];
		if ((first?.responsibility ?? "") !== (second?.responsibility ?? "")) return false;
		if ((first?.instructions ?? "") !== (second?.instructions ?? "")) return false;
	}
	return true;
}
