import { useAgentAvatarResolver } from "@shared/agent-teams/agent-avatar";
import { ModelSelect } from "@shared/components/ModelSelect";
import { useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import { useTeamMemberModels } from "@shared/agent-teams/useTeamMemberModels";
import { resolveReasoning } from "@shared/components/ModelSelect/resolveReasoning";
import { DEFAULT_TEAM_AUTOMATIC_RETRIES } from "@vetta/agent-team";
import type { AgentProfile, TeamDefinition, TeamMemberAssignment } from "@vetta/agent-team";
import { AgentAvatarView } from "@vetta-org/theme-ui/chat";
import { DetailDrawer, DetailDrawerEnter } from "@vetta-org/theme-ui/overlays";
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
} from "@vetta-org/ui";
import { RendererMarkdownContent } from "@shared/components/RendererMarkdownContent";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatarStack } from "./agent-center/AgentAvatarStack";
import { type BlueprintDisplayPlugin, resourceProviderName } from "../lib/blueprint-display";
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
	/** 解析提供方显示名用；缺省视为没有任何扩展在位。 */
	readonly plugins?: readonly BlueprintDisplayPlugin[];
	readonly onClose: () => void;
	readonly onExited?: () => void;
	readonly onSave: (draft: TeamAssemblyDraft) => Promise<TeamDefinition | undefined>;
	/** 省略时不出现删除入口：提供方维护的团队不允许删除。 */
	readonly onDelete?: () => void;
	/** 打开某位成员的档案抽屉，让能力配置回到同一套编辑入口。 */
	readonly onOpenMember: (agentId: string) => void;
}

/** 团队设置抽屉：与智能体档案、能力详情共用同一枚抽屉壳。 */
export function TeamSettingsSheet({
	open,
	team,
	agents,
	agentsById,
	plugins = [],
	onClose,
	onExited,
	onSave,
	onDelete,
	onOpenMember,
}: TeamSettingsSheetProps): JSX.Element {
	const { t, i18n } = useTranslation("agent-teams");
	const resolveAvatar = useAgentAvatarResolver();
	const [draft, setDraft] = useState<TeamAssemblyDraft>(() => assemblyDraftFromTeam(team));
	const [addOpen, setAddOpen] = useState(false);
	const [addBindingKind, setAddBindingKind] = useState<"reference" | "copy">("reference");
	/** 正在展开任务书编辑区的成员（Agent 身份）；任务书随团队一起保存，不单独落盘。 */
	const [assignmentAgentId, setAssignmentAgentId] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const { state: modelState, select: setMemberModel, reload: reloadModels } = useTeamMemberModels(team.id, open);
	const memberModels = modelState?.models ?? {};
	const modelError = modelState?.error;
	const { options: modelOptions } = useModelOptions();

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

	const providerName = resourceProviderName(team.source, plugins, i18n.language);
	// 提供方维护的团队只读：阵容、任务书、名称都由清单说了算，插件升级会整体重铺。
	const readOnly = team.source !== undefined;

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
								{/* 团队的「脸」是成员本身，用头像组顶在标题上方，比一枚通用图标更认得出是哪支队。 */}
								<div className="flex min-w-0 flex-col gap-2.5">
									<AgentAvatarStack agents={members} leaderId={leaderId} emptyIcon />
									<div className="min-w-0">
										<h1 className="truncate text-[20px] font-semibold leading-snug tracking-tight text-foreground">
											{draft.name || team.name}
										</h1>
										<div className="mt-1.5 flex flex-wrap items-center gap-2">
											<p className="text-[11px] text-muted-foreground/70">
												{t("teams.memberCount", { count: members.length })}
											</p>
											{providerName && (
												<span
													className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
													title={t("center.providedByHint")}
												>
													<span className="icon-[solar--box-minimalistic-linear] h-3 w-3" aria-hidden="true" />
													{t("center.providedBy", { name: providerName })}
												</span>
											)}
										</div>
									</div>
								</div>

								{readOnly ? (
									<p className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
										<span className="icon-[solar--lock-keyhole-linear] mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
										<span>{t("settings.providedDefinitionReadOnly")}</span>
									</p>
								) : (
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
									{onDelete && (
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
									)}
								</div>
								)}

								{error && (
									<p aria-live="polite" className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
										{error}
									</p>
								)}
								<p className="text-[12px] text-muted-foreground">{t("models.scopeHint")}</p>
								{modelError && (
									<div role="alert">
										<p>{modelError}</p>
										<Button variant="ghost" onClick={() => void reloadModels()}>{t("models.retry")}</Button>
									</div>
								)}
							</div>
						</DetailDrawerEnter>

						<DetailDrawerEnter index={1} className="flex flex-col gap-4">
							<SectionTitle>{t("settings.identity")}</SectionTitle>
							{readOnly ? (
								<>
									<ReadOnlyField label={t("teams.name")}>
										<p className="text-[13px] text-foreground">{team.name}</p>
									</ReadOnlyField>
									{team.description.trim() && (
										<ReadOnlyField label={t("settings.description")}>
											<p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">
												{team.description}
											</p>
										</ReadOnlyField>
									)}
								</>
							) : (
								<>
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
									<label className="flex flex-col gap-1.5">
										<span className="text-[12px] font-medium text-foreground">{t("settings.automaticRetries")}</span>
										<Input
											type="number" min={0} max={10} step={1}
											value={Number.isNaN(draft.maxAutomaticRetries) ? "" : draft.maxAutomaticRetries ?? DEFAULT_TEAM_AUTOMATIC_RETRIES}
											onChange={(event) => setDraft((current) => ({ ...current, maxAutomaticRetries: event.target.valueAsNumber }))}
											aria-label={t("settings.automaticRetries")}
											aria-describedby="team-automatic-retries-help"
											className="h-9"
										/>
										<span id="team-automatic-retries-help" className="text-[11px] text-muted-foreground">{t("settings.automaticRetriesHelp")}</span>
									</label>
								</>
							)}
						</DetailDrawerEnter>

						<DetailDrawerEnter index={2} className="flex flex-col gap-3">
							<div className="flex items-center justify-between gap-3">
								<SectionTitle>{t("settings.members")}</SectionTitle>
								{!readOnly && (
									<Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
										<span className="icon-[solar--user-plus-linear] h-4 w-4" aria-hidden="true" />
										<span className="text-[12px] font-medium">{t("settings.addMember")}</span>
									</Button>
								)}
							</div>

							<ul className="flex flex-col gap-1.5">
								{members.map((member) => {
									const isLeader = member.id === leaderId;
									const memberId = team.members.find((candidate) => candidate.binding.agentProfileId === member.id)?.id;
									const selectedModel = memberId ? memberModels[memberId]?.modelKey : undefined;
									const modelUnavailable = Boolean(selectedModel && modelOptions.length > 0 && !modelOptions.some((option) => option.key === selectedModel));
									return (
										<li
											key={member.id}
											className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/40 p-2.5 transition-colors hover:border-primary/40 hover:bg-card/60"
										>
											<div className="flex items-center gap-3">
												<AgentAvatarView
													name={member.name}
													avatar={resolveAvatar(member)}
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
												{!isLeader && !readOnly && (
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
												{!readOnly && (
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
												)}
											</div>

											{assignmentAgentId === member.id && readOnly ? (
												<MemberAssignmentView
													agent={member}
													assignment={assemblyAssignment(draft, member.id)}
													onClose={() => setAssignmentAgentId(undefined)}
												/>
											) : assignmentAgentId === member.id ? (
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
													readOnly={readOnly}
													onOpen={() => setAssignmentAgentId(member.id)}
												/>
											)}
											{memberId ? <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2">
												<span className="text-[11px] font-medium text-muted-foreground">{t("settings.memberModel")}</span>
												<ModelSelect
													value={selectedModel ?? null}
													onChange={(value) => {
														const defaultReasoning = resolveReasoning(modelOptions.find((option) => option.key === value))?.default;
														void setMemberModel(memberId, value ? { modelKey: value, ...(defaultReasoning ? { reasoning: defaultReasoning } : {}) } : null);
													}}
													allowClear
													clearLabel={t("settings.memberModelInherit")}
													disabled={!modelState?.models || modelState.loading || modelState.saving}
													placeholder={!modelState?.models ? t("models.loading") : selectedModel ?? t("settings.memberModelInherit")}
													triggerClassName="w-full justify-between"
													reasoning={selectedModel ? { value: memberModels[memberId]?.reasoning, onChange: (reasoning) => void setMemberModel(memberId, { modelKey: selectedModel, reasoning }) } : undefined}
												/>
												<span className="text-[11px] text-muted-foreground/70">{!modelState?.models ? t("models.loading") : selectedModel ? t("settings.memberModelFixedHint") : t("settings.memberModelInheritHint")}</span>
												{modelUnavailable ? <span role="status" className="text-[11px] text-destructive">{t("settings.memberModelUnavailable", { model: selectedModel })}</span> : null}
											</div> : null}
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
										avatar={resolveAvatar(agent)}
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
	readOnly = false,
	onOpen,
}: {
	readonly agent: AgentProfile;
	readonly assignment?: TeamMemberAssignment;
	/** 只读仍可展开查看：提供方写的职责与补充指令正是用户最想看的内容，只是改不动。 */
	readonly readOnly?: boolean;
	readonly onOpen: () => void;
}): JSX.Element | null {
	const { t } = useTranslation("agent-teams");
	if (!assignment) {
		// 只读且本来就没有任务书时不留空位：一个「写任务书」按钮只会误导。
		if (readOnly) return null;
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
			aria-label={t(readOnly ? "settings.viewAssignment" : "settings.editAssignment", { name: agent.name })}
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
			<span
				className={cn(
					"mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70",
					readOnly ? "icon-[solar--alt-arrow-down-linear]" : "icon-[solar--pen-2-linear]",
				)}
				aria-hidden="true"
			/>
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
	// 已有补充指令先按 Markdown 排给人读，点「编辑」才换回源码；空的直接给输入框，省一次点击。
	const [editingInstructions, setEditingInstructions] = useState(!assignment?.instructions?.trim());

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

			<div className="flex flex-col gap-1.5">
				<div className="flex items-center justify-between gap-2">
					<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
						{t("settings.assignmentInstructions")}
					</span>
					{!editingInstructions && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
							onClick={() => setEditingInstructions(true)}
						>
							<span className="icon-[solar--pen-2-linear] h-3 w-3" aria-hidden="true" />
							{t("settings.assignmentEditInstructions")}
						</Button>
					)}
				</div>
				{editingInstructions ? (
					<textarea
						value={instructions}
						onChange={(event) => setInstructions(event.target.value)}
						rows={12}
						autoFocus={Boolean(assignment?.instructions?.trim())}
						placeholder={t("settings.assignmentInstructionsPlaceholder")}
						aria-label={t("settings.assignmentInstructions")}
						className="min-h-60 w-full resize-y rounded-xl border border-border/60 bg-background/50 px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-foreground caret-primary outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
					/>
				) : (
					<InstructionsMarkdown text={instructions} />
				)}
				<span className="text-[11px] text-muted-foreground/60">{t("settings.assignmentInstructionsHint")}</span>
			</div>

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

/** 提供方维护的任务书：只摆 label 与内容，不给任何输入框的外观——这里本来就没有可改的东西。 */
function MemberAssignmentView({
	agent,
	assignment,
	onClose,
}: {
	readonly agent: AgentProfile;
	readonly assignment?: TeamMemberAssignment;
	readonly onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-background/40 p-3">
			<h3 className="text-[12.5px] font-semibold text-foreground">
				{t("settings.assignmentTitle", { name: agent.name })}
			</h3>
			{assignment?.responsibility && (
				<ReadOnlyField label={t("settings.assignmentResponsibility")}>
					<p className="text-[12.5px] leading-relaxed text-foreground/90">{assignment.responsibility}</p>
				</ReadOnlyField>
			)}
			{assignment?.instructions && (
				<ReadOnlyField label={t("settings.assignmentInstructions")}>
					<InstructionsMarkdown text={assignment.instructions} />
				</ReadOnlyField>
			)}
			<div className="flex justify-end">
				<Button variant="outline" size="sm" onClick={onClose}>
					<span className="text-[12px] font-medium">{t("settings.assignmentCollapse")}</span>
				</Button>
			</div>
		</div>
	);
}

/** 补充指令往往是整段流水线说明，给足高度再滚动，别让人在三行小框里翻页。 */
function InstructionsMarkdown({ text }: { readonly text: string }): JSX.Element {
	return (
		<div
			data-testid="assignment-instructions-markdown"
			className="max-h-[28rem] min-h-24 overflow-y-auto rounded-xl border border-border/40 bg-background/30 px-3.5 py-2.5 text-[12.5px] leading-relaxed"
		>
			<RendererMarkdownContent text={text} />
		</div>
	);
}

function ReadOnlyField({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{label}</span>
			{children}
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
		left.maxAutomaticRetries === right.maxAutomaticRetries &&
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
