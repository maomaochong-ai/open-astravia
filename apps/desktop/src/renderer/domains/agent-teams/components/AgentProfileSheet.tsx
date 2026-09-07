import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { AgentBlueprint, AgentProfile, AgentProfileUpdateImpact } from "@vetta/agent-team";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { DetailDrawer, DetailDrawerEnter } from "@vetta/theme-ui/overlays";
import { Button, cn } from "@vetta/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentProfileEditInput } from "../hooks/useAgentLibraryModel";
import { isAgentAbilitySelected } from "../lib/ability-selection";
import type { AgentCapabilityOption } from "../lib/capability-options";
import { AgentProfileEditor, type AgentProfileTab } from "./AgentProfileEditor";

export interface AgentProfileSheetProps {
	readonly open: boolean;
	readonly mode: "create" | "edit";
	/** 编辑既有智能体时给出档案；创建时为空，浮层内部起草一份未落盘的草稿。 */
	readonly agent?: AgentProfile;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly onClose: () => void;
	readonly onExited?: () => void;
	/** 落盘成功后通知外层刷新依赖该智能体的团队视图。 */
	readonly onSaved: () => void;
	readonly onPreview: (agentId: string) => Promise<AgentProfileUpdateImpact>;
	readonly onSave: (
		agent: AgentProfile,
		input: AgentProfileEditInput,
	) => Promise<{ updated: AgentProfile; impact: AgentProfileUpdateImpact }>;
	/** 创建模式必填：确认创建时把草稿写入智能体库。 */
	readonly onCreate?: (input: AgentProfileEditInput) => Promise<AgentProfile | undefined>;
	/** 省略时底部不出现删除入口。 */
	readonly onDelete?: () => void;
}

const SHEET_TABS = [
	{ id: "basic", labelKey: "center.tabBasic", icon: "icon-[solar--user-id-linear]" },
	{ id: "prompt", labelKey: "center.tabPrompt", icon: "icon-[solar--document-text-linear]" },
	{ id: "abilities", labelKey: "center.tabAbilities", icon: "icon-[solar--bolt-circle-linear]" },
] as const;

/** 智能体档案抽屉：与能力详情共用同一枚抽屉壳，表单主体复用 `AgentProfileEditor`。 */
export function AgentProfileSheet({
	open,
	mode,
	agent,
	blueprints,
	capabilities,
	onClose,
	onExited,
	onSaved,
	onPreview,
	onSave,
	onCreate,
	onDelete,
}: AgentProfileSheetProps): JSX.Element | null {
	const { t } = useTranslation("agent-teams");
	const [activeTab, setActiveTab] = useState<AgentProfileTab>("basic");
	const [saveRequest, setSaveRequest] = useState(0);
	const [saving, setSaving] = useState(false);
	const [draft, setDraft] = useState<AgentProfileEditInput>();

	const draftAgent = useMemo(() => (agent ? undefined : buildDraftAgent(blueprints)), [agent, blueprints]);
	const target = agent ?? draftAgent;
	const abilityCount = draft
		? capabilities.filter((option) => isAgentAbilitySelected(draft.abilities, option)).length
		: 0;

	if (!target) return null;

	const blueprint = blueprints.find((candidate) => candidate.id === target.blueprintId);
	const displayName = draft?.name?.trim() || target.name || t("center.sheetCreateTitle");

	return (
		<DetailDrawer
			open={open}
			title={displayName}
			description={draft?.description ?? target.description}
			onClose={onClose}
			onExited={onExited}
		>
			<div className="relative h-full overflow-hidden">
				<div className="absolute inset-0 overflow-y-auto overflow-x-hidden px-5 pb-8 pt-8">
					<div className="flex w-full flex-col gap-8">
						<DetailDrawerEnter index={0}>
							<div className="flex flex-col gap-4">
								<div className="flex items-start gap-4">
									<AgentAvatarView
										name={displayName}
										avatar={draft?.avatar ?? agentAvatarUrl(target)}
										background={draft ? draft.avatarBackground : target.avatarBackground}
										blueprintId={target.blueprintId}
										seed={target.id || target.blueprintId}
										size="hero"
									/>
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<h1 className="truncate text-[20px] font-semibold leading-snug tracking-tight text-foreground">
												{displayName}
											</h1>
											{blueprint && (
												<span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
													{t(blueprint.nameKey as never)}
												</span>
											)}
										</div>
										<p className="mt-1.5 text-[11px] text-muted-foreground/70">
											{mode === "edit" ? t("center.sheetEditTitle") : t("center.sheetCreateTitle")}
										</p>
									</div>
								</div>

								{(draft?.description ?? target.description) && (
									<p className="text-[14px] leading-relaxed text-muted-foreground">
										{draft?.description ?? target.description}
									</p>
								)}

								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="primary"
										size="lg"
										className="min-w-40 flex-1"
										disabled={saving}
										onClick={() => setSaveRequest((value) => value + 1)}
									>
										<span
											className={cn(
												"h-4 w-4",
												saving ? "icon-[solar--refresh-linear] animate-spin" : "icon-[solar--diskette-linear]",
											)}
											aria-hidden="true"
										/>
										{saving ? t("center.saving") : mode === "edit" ? t("center.saveChanges") : t("center.confirmCreate")}
									</Button>
									{onDelete && mode === "edit" && (
										<Button
											variant="outline"
											size="lg"
											className="text-muted-foreground hover:text-destructive"
											title={t("library.delete")}
											aria-label={t("library.delete")}
											onClick={onDelete}
										>
											<span className="icon-[solar--trash-bin-trash-linear] h-4 w-4" aria-hidden="true" />
										</Button>
									)}
								</div>
							</div>
						</DetailDrawerEnter>

						<DetailDrawerEnter index={1} className="flex flex-col gap-5">
							<div className="flex items-center gap-1 rounded-lg bg-accent/40 p-1" role="tablist">
								{SHEET_TABS.map((tab) => (
									<button
										key={tab.id}
										type="button"
										role="tab"
										aria-selected={activeTab === tab.id}
										onClick={() => setActiveTab(tab.id)}
										className={cn(
											"flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium outline-none transition-colors",
											activeTab === tab.id ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
										)}
									>
										<span className={`${tab.icon} h-3.5 w-3.5`} aria-hidden="true" />
										<span>
											{tab.id === "abilities" ? t("center.tabAbilities", { count: abilityCount }) : t(tab.labelKey)}
										</span>
									</button>
								))}
							</div>

							<AgentProfileEditor
								key={target.id || "draft"}
								agent={target}
								blueprint={blueprint}
								capabilities={capabilities}
								layout="sheet"
								activeTab={activeTab}
								onActiveTabChange={setActiveTab}
								hideSaveAction
								saveRequest={saveRequest}
								onDraftChange={setDraft}
								onSavingChange={setSaving}
								onSaveComplete={() => {
									onSaved();
									onClose();
								}}
								onPreview={mode === "create" ? previewNoop : onPreview}
								onSave={
									mode === "create"
										? async (_agent, input) => {
												const created = await onCreate?.(input);
												if (!created) throw new Error(t("center.createAgentFailed"));
												return { updated: created, impact: await previewNoop() };
											}
										: onSave
								}
							/>
						</DetailDrawerEnter>
					</div>
				</div>
			</div>
		</DetailDrawer>
	);
}

async function previewNoop(): Promise<AgentProfileUpdateImpact> {
	return { agentProfileId: "", teamIds: [], teamNames: [] };
}

/** 创建模式下的未落盘草稿：确认创建时才写入智能体库。 */
function buildDraftAgent(blueprints: readonly AgentBlueprint[]): AgentProfile | undefined {
	const blueprint = blueprints[0];
	if (!blueprint) return undefined;
	const now = Date.now();
	return {
		id: "",
		revision: 0,
		name: "",
		description: "",
		mentionHandle: "",
		blueprintId: blueprint.id,
		abilities: { selectionMode: "custom", skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		createdAt: now,
		updatedAt: now,
	};
}
