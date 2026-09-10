import type { AgentAbilitySelection, AgentBlueprint, AgentProfile, AgentProfileUpdateImpact } from "@vetta/agent-team";
import { Button, cn, Input, Switch } from "@vetta/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GroupedVirtuoso } from "react-virtuoso";
import type { AgentProfileEditInput } from "../hooks/useAgentLibraryModel";
import type { AgentCapabilityOption } from "../lib/capability-options";
import {
	isAgentAbilitySelected,
	normalizeAgentAbilitySelection,
	selectAllAgentAbilities,
	toggleAgentAbility,
} from "../lib/ability-selection";
import { AbilityIcon } from "../../abilities/components/AbilityIcon";
import { agentAvatarUrl } from "../../../shared/agent-teams/agent-avatar";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { AgentAvatarPicker } from "./AgentAvatarPicker";

export type AgentProfileTab = "basic" | "prompt" | "abilities";

interface AgentProfileEditorProps {
	readonly agent: AgentProfile;
	readonly blueprint?: AgentBlueprint;
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly displayName?: string;
	readonly displayDescription?: string;
	readonly layout?: "stacked" | "columns" | "sheet";
	/** 受控页签：`sheet` 布局把页签条交给外层浮层渲染。 */
	readonly activeTab?: AgentProfileTab;
	readonly onActiveTabChange?: (tab: AgentProfileTab) => void;
	readonly saveRequest?: number;
	readonly hideSaveAction?: boolean;
	readonly onDraftChange?: (input: AgentProfileEditInput) => void;
	readonly onSavingChange?: (saving: boolean) => void;
	readonly onSaveComplete?: () => void;
	readonly onPreview: (agentId: string) => Promise<AgentProfileUpdateImpact>;
	readonly onSave: (
		agent: AgentProfile,
		input: AgentProfileEditInput,
	) => Promise<{ updated: AgentProfile; impact: AgentProfileUpdateImpact }>;
}

export function AgentProfileEditor({
	agent,
	blueprint,
	capabilities,
	displayName,
	displayDescription,
	activeTab: controlledTab,
	onActiveTabChange,
	saveRequest,
	layout = "stacked",
	hideSaveAction = false,
	onDraftChange,
	onSavingChange,
	onSaveComplete,
	onPreview,
	onSave,
}: AgentProfileEditorProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const [name, setName] = useState(agent.name);
	const [description, setDescription] = useState(agent.description);
	const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt ?? "");
	const [avatar, setAvatar] = useState(agentAvatarUrl(agent));
	const [abilities, setAbilities] = useState<AgentAbilitySelection>(() =>
		normalizeAgentAbilitySelection(agent.abilities, capabilities),
	);
	const [uncontrolledTab, setUncontrolledTab] = useState<AgentProfileTab>("basic");
	const activeTab = controlledTab ?? uncontrolledTab;
	const setActiveTab = onActiveTabChange ?? setUncontrolledTab;
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [pendingImpact, setPendingImpact] = useState<AgentProfileUpdateImpact>();
	const [error, setError] = useState<string>();
	const lastSaveRequest = useRef(saveRequest);

	useEffect(() => {
		setName(agent.name);
		setDescription(agent.description);
		setSystemPrompt(agent.systemPrompt ?? "");
		setAvatar(agentAvatarUrl(agent));
		setAbilities(normalizeAgentAbilitySelection(agent.abilities, capabilities));
		setPendingImpact(undefined);
		setSaved(false);
		setError(undefined);
	}, [agent, capabilities, displayDescription, displayName]);

	useEffect(() => {
		onDraftChange?.({
			name,
			description,
			systemPrompt,
			avatar,
			mentionHandle: agent.mentionHandle,
			abilities,
		});
	}, [abilities, agent.mentionHandle, avatar, description, name, onDraftChange, systemPrompt]);

	useEffect(() => {
		onSavingChange?.(saving);
	}, [onSavingChange, saving]);

	useEffect(() => {
		if (saveRequest === undefined || saveRequest === lastSaveRequest.current) return;
		lastSaveRequest.current = saveRequest;
		void save();
	}, [saveRequest]);

	async function save(): Promise<void> {
		setSaving(true);
		setSaved(false);
		setError(undefined);
		try {
			if (!pendingImpact) {
				const preview = await onPreview(agent.id);
				if (preview.teamIds.length > 1) {
					setPendingImpact(preview);
					return;
				}
			}
			await onSave(agent, {
				name,
				description,
				systemPrompt,
				avatar,
				mentionHandle: agent.mentionHandle,
				abilities,
			});
			onSaveComplete?.();
			setPendingImpact(undefined);
			setSaved(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(false);
		}
	}

	if (layout === "sheet") {
		return (
			<div className="flex h-full min-h-0 flex-col gap-5">
				{activeTab === "basic" && (
					<div className="flex flex-col gap-5">
						<div className="flex items-center gap-4">
							<AgentAvatarView
								name={name || (displayName ?? agent.name)}
								avatar={avatar}
								blueprintId={agent.blueprintId}
								size="hero"
								className="h-16 w-16"
							/>
							<div className="min-w-0">
								<span className="block truncate text-[14px] font-semibold text-foreground">
									{name || (displayName ?? agent.name)}
								</span>
								{blueprint && (
									<span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
										<span className="icon-[solar--shield-user-linear] h-3 w-3" aria-hidden="true" />
										{t(blueprint.nameKey as never)}
									</span>
								)}
							</div>
						</div>

						<AgentAvatarPicker value={avatar} onChange={setAvatar} />

						<TextField label={t("profile.name")} value={name} onChange={setName} />

						<label className="block text-sm">
							<span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
								{t("profile.description")}
							</span>
							<textarea
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								rows={3}
								placeholder={t("profile.descriptionPlaceholder")}
								className="min-h-20 w-full resize-none rounded-xl border border-border/60 bg-background/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-foreground caret-primary outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
							/>
						</label>
					</div>
				)}

				{activeTab === "prompt" && (
					<div className="flex min-h-0 flex-1 flex-col gap-3">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<span className="block text-[12px] font-medium text-foreground">{t("profile.systemPrompt")}</span>
								<span className="mt-0.5 block text-[11px] text-muted-foreground">{t("profile.systemPromptHint")}</span>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground"
								onClick={() => setSystemPrompt("")}
							>
								{t("profile.clearPrompt")}
							</Button>
						</div>
						<textarea
							aria-label={t("profile.systemPrompt")}
							value={systemPrompt}
							onChange={(event) => setSystemPrompt(event.target.value)}
							placeholder={t("profile.systemPromptPlaceholder")}
							className="min-h-70 w-full flex-1 resize-none rounded-xl border border-border/60 bg-background/50 p-3.5 font-mono text-[12px] leading-relaxed text-foreground caret-primary outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
						/>
					</div>
				)}

				{activeTab === "abilities" && (
					<AbilityEditor abilities={abilities} capabilities={capabilities} onChange={setAbilities} />
				)}

				{pendingImpact && pendingImpact.teamIds.length > 1 && (
					<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-400">
						{t("profile.sharedImpact", {
							count: pendingImpact.teamIds.length,
							teams: pendingImpact.teamNames.join("、"),
						})}
					</div>
				)}

				{error && (
					<span aria-live="polite" className="rounded-lg bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
						{error}
					</span>
				)}
			</div>
		);
	}

	if (layout === "columns") {
		const selectedAbilitiesCount = capabilities.filter(
			(option) =>
				option.visibleInAgentConfiguration !== false && isAgentAbilitySelected(abilities, option),
		).length;

		return (
			<div className="flex h-full min-h-0 flex-1 overflow-hidden">
				{/* Left Navigation Sidebar */}
				<aside className="flex w-60 shrink-0 flex-col border-r border-border/50 bg-card/15 p-4">
					{/* Compact Member Summary Card */}
					<div className="mb-4 flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 p-3">
						<div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-muted/20">
							<img src={avatar} alt="" className="h-full w-full object-cover" />
						</div>
						<div className="min-w-0 flex-1">
							<span className="block truncate text-sm font-bold text-foreground">
								{displayName ?? agent.name}
							</span>
							{blueprint && (
								<span className="block truncate text-[11px] font-medium text-primary">
									{t(blueprint.nameKey as never)}
								</span>
							)}
						</div>
					</div>

					{/* Navigation Menu Items */}
					<nav className="flex flex-1 flex-col gap-1" aria-label={t("settings.editMemberTitle")}>
						<button
							type="button"
							onClick={() => setActiveTab("basic")}
							className={cn(
								"flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors outline-none",
								activeTab === "basic"
									? "border border-primary/40 bg-primary/10 text-primary font-semibold"
									: "border border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
							)}
						>
							<span className="icon-[solar--user-id-linear] h-4 w-4" aria-hidden="true" />
							<span className="flex-1 text-left">{t("profile.basicInfo")}</span>
						</button>

						<button
							type="button"
							onClick={() => setActiveTab("prompt")}
							className={cn(
								"flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors outline-none",
								activeTab === "prompt"
									? "border border-primary/40 bg-primary/10 text-primary font-semibold"
									: "border border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
							)}
						>
							<span className="icon-[solar--document-text-linear] h-4 w-4" aria-hidden="true" />
							<span className="flex-1 text-left">{t("profile.systemPrompt")}</span>
						</button>

						<button
							type="button"
							onClick={() => setActiveTab("abilities")}
							className={cn(
								"flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors outline-none",
								activeTab === "abilities"
									? "border border-primary/40 bg-primary/10 text-primary font-semibold"
									: "border border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
							)}
						>
							<span className="icon-[solar--bolt-circle-linear] h-4 w-4" aria-hidden="true" />
							<span className="flex-1 text-left">{t("profile.abilities")}</span>
							<span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
								{selectedAbilitiesCount}
							</span>
						</button>
					</nav>

					{/* Shared Impact Banner if applicable */}
					{pendingImpact && pendingImpact.teamIds.length > 1 && (
						<div className="mt-auto rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
							<div className="flex items-start gap-2">
								<span className="icon-[solar--danger-triangle-linear] mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
								<div className="min-w-0 flex-1">
									{t("profile.sharedImpact", {
										count: pendingImpact.teamIds.length,
										teams: pendingImpact.teamNames.join("、"),
									})}
									<div className="mt-2">
										<Button variant="outline" size="sm" className="h-7 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/20" onClick={() => void save()}>
											{t("profile.confirmSharedSave")}
										</Button>
									</div>
								</div>
							</div>
						</div>
					)}
				</aside>

				{/* Right Content Workspace */}
				<section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
					{activeTab === "basic" && (
						<div className="max-w-2xl space-y-5">
							<div>
								<h3 className="text-base font-bold text-foreground">{t("profile.basicInfo")}</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									{t("profile.fixedPrompt", {
										role: blueprint ? t(blueprint.nameKey as never) : agent.blueprintId,
									})}
								</p>
							</div>

							<div className="flex flex-col gap-5 rounded-2xl border border-border/50 bg-card/25 p-5">
								<AgentAvatarPicker value={avatar} onChange={setAvatar} />
								<TextField
									label={t("profile.name")}
									value={name}
									onChange={setName}
								/>
								<label className="block text-sm">
									<span className="mb-1.5 block text-xs font-semibold tracking-wider uppercase text-muted-foreground/80">
										{t("profile.description")}
									</span>
									<textarea
										value={description}
										onChange={(event) => setDescription(event.target.value)}
										className="min-h-24 w-full cursor-text resize-y rounded-xl border border-border/60 bg-background/50 px-3.5 py-2.5 text-xs text-foreground caret-primary outline-none transition-all placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
									/>
								</label>
							</div>
						</div>
					)}

					{activeTab === "prompt" && (
						<div className="flex h-full min-h-0 flex-1 flex-col space-y-4">
							<div>
								<h3 className="text-base font-bold text-foreground">{t("profile.systemPrompt")}</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									{t("profile.fixedPrompt", {
										role: blueprint ? t(blueprint.nameKey as never) : agent.blueprintId,
									})}
								</p>
							</div>

							<div className="flex flex-1 min-h-0 flex-col rounded-2xl border border-border/50 bg-card/25 p-4">
								<textarea
									aria-label={t("profile.systemPrompt")}
									value={systemPrompt}
									onChange={(event) => setSystemPrompt(event.target.value)}
									placeholder={t("profile.systemPromptPlaceholder")}
									className="flex-1 min-h-[360px] w-full cursor-text resize-none rounded-xl border border-border/60 bg-background/50 p-4 text-xs font-mono leading-relaxed text-foreground caret-primary outline-none transition-all placeholder:text-muted-foreground/40 hover:border-border focus:border-primary/50 focus:bg-background"
								/>
							</div>
						</div>
					)}

					{activeTab === "abilities" && (
						<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
							<AbilityEditor
								abilities={abilities}
								capabilities={capabilities}
								onChange={setAbilities}
							/>
						</div>
					)}
				</section>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-4xl space-y-6 pb-12">
			{/* Member Identity Hero Banner */}
			<div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card/70 via-card/40 to-background/40 p-6 backdrop-blur-sm">
				<div className="flex flex-wrap items-center gap-5">
					<div className="relative shrink-0">
						<div className="h-16 w-16 overflow-hidden rounded-2xl border border-border/60 bg-muted/30">
							<img src={avatar} alt="" className="h-full w-full object-cover" />
						</div>
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2.5">
							<h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
								{displayName ?? agent.name}
							</h2>
							{blueprint && (
								<span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
									<span className="icon-[solar--shield-user-bold] h-3 w-3" aria-hidden="true" />
									{t(blueprint.nameKey as never)}
								</span>
							)}
						</div>
						<p className="mt-1.5 text-xs text-muted-foreground/80">
							{t("profile.fixedPrompt", {
								role: blueprint ? t(blueprint.nameKey as never) : agent.blueprintId,
							})}
						</p>
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-6">
				{/* Basic Identity Card */}
				<section className="rounded-2xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
					<div className="mb-5 flex items-center gap-2 border-b border-border/40 pb-3.5">
						<span className="icon-[solar--user-id-linear] h-4 w-4 text-primary" aria-hidden="true" />
						<h3 className="text-sm font-semibold tracking-tight text-foreground">{t("profile.name")} & {t("profile.avatar")}</h3>
					</div>
					<div className="flex flex-col gap-6">
						<AgentAvatarPicker value={avatar} onChange={setAvatar} />
						<TextField
							label={t("profile.name")}
							value={name}
							onChange={setName}
						/>
						<label className="text-sm">
							<span className="mb-1.5 block text-xs font-semibold tracking-wider uppercase text-muted-foreground/80">
								{t("profile.description")}
							</span>
							<textarea
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								className="min-h-24 w-full resize-y rounded-xl border border-border/60 bg-background/50 px-3.5 py-2.5 text-sm outline-none transition-all placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
							/>
						</label>
						<label className="text-sm">
							<span className="mb-1.5 block text-xs font-semibold tracking-wider uppercase text-muted-foreground/80">
								{t("profile.systemPrompt")}
							</span>
							<textarea
								aria-label={t("profile.systemPrompt")}
								value={systemPrompt}
								onChange={(event) => setSystemPrompt(event.target.value)}
								className="min-h-40 w-full resize-y rounded-xl border border-border/60 bg-background/50 px-3.5 py-2.5 text-sm font-mono leading-relaxed outline-none transition-all placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:bg-background"
							/>
						</label>
					</div>
				</section>

				{/* Abilities Configuration Card */}
				<AbilityEditor
					abilities={abilities}
					capabilities={capabilities}
					onChange={setAbilities}
				/>

				{pendingImpact && pendingImpact.teamIds.length > 1 && (
					<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
						<div className="flex items-start gap-2.5">
							<span className="icon-[solar--danger-triangle-linear] mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
							<div className="min-w-0 flex-1">
								{t("profile.sharedImpact", {
									count: pendingImpact.teamIds.length,
									teams: pendingImpact.teamNames.join("、"),
								})}
								<div className="mt-3">
									<Button variant="outline" size="sm" className="border-amber-500/40 text-amber-300 hover:bg-amber-500/20" onClick={() => void save()}>
										{t("profile.confirmSharedSave")}
									</Button>
								</div>
							</div>
						</div>
					</div>
				)}

				{!hideSaveAction && (
					<div className="flex items-center gap-3 pt-2">
						<Button variant="primary" disabled={saving} onClick={() => void save()} className="gap-2">
							<span className="icon-[solar--diskette-bold] h-4 w-4" aria-hidden="true" />
							{saving ? t("profile.saving") : t("profile.save")}
						</Button>
						<span aria-live="polite" className="text-xs text-muted-foreground">
							{saved ? t("profile.savedNextTurn") : ""}
						</span>
					</div>
				)}

				{error && (
					<span aria-live="polite" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
						{error}
					</span>
				)}
			</div>
		</div>
	);
}

function AbilityEditor({
	abilities,
	capabilities,
	onChange,
}: {
	readonly abilities: AgentAbilitySelection;
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly onChange: (abilities: AgentAbilitySelection) => void;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const [query, setQuery] = useState("");
	const configurableCapabilities = capabilities.filter(
		(option) => option.visibleInAgentConfiguration !== false,
	);
	const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
	const filterItems = (items: readonly AgentCapabilityOption[]) =>
		items.filter(
				(option) =>
					!normalizedQuery ||
						`${option.title}\n${option.description}\n${option.id}\n${option.sourceName ?? ""}`
							.normalize("NFKC")
							.toLocaleLowerCase()
							.includes(normalizedQuery),
			);
	const pluginResourceGroups = (kind: "skill" | "scene") => {
		const byPlugin = new Map<string, { label: string; items: AgentCapabilityOption[] }>();
		for (const option of configurableCapabilities) {
			if (option.kind !== kind || !option.sourcePluginId) continue;
			const current = byPlugin.get(option.sourcePluginId) ?? {
				label: t(kind === "skill" ? "profile.pluginSkills" : "profile.pluginScenes", {
					plugin: option.sourceName || option.sourcePluginId,
				}),
				items: [],
			};
			current.items.push(option);
			byPlugin.set(option.sourcePluginId, current);
		}
		return [...byPlugin.values()].sort((left, right) => left.label.localeCompare(right.label));
	};
	const grouped = [
		{
			label: t("profile.skills"),
			items: configurableCapabilities.filter((option) => option.kind === "skill" && !option.sourcePluginId),
		},
		...pluginResourceGroups("skill"),
		{
			label: t("profile.scenes"),
			items: configurableCapabilities.filter((option) => option.kind === "scene" && !option.sourcePluginId),
		},
		...pluginResourceGroups("scene"),
		{ label: t("profile.mcp"), items: configurableCapabilities.filter((option) => option.kind === "mcp") },
		{ label: t("profile.plugins"), items: configurableCapabilities.filter((option) => option.kind === "plugin") },
	]
		.map((group) => ({ ...group, items: filterItems(group.items) }))
		.filter((group) => group.items.length > 0);
	const visibleCapabilities = grouped.flatMap((group) => group.items);
	const selectedCount = configurableCapabilities.filter((option) =>
		isAgentAbilitySelected(abilities, option),
	).length;
	return (
		<section className="overflow-hidden rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm">
			<div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/50 bg-card/20 px-6 py-4">
				<div>
					<div className="flex flex-wrap items-center gap-2.5">
						<span className="icon-[solar--bolt-circle-linear] h-4 w-4 text-primary" aria-hidden="true" />
						<h3 className="text-sm font-semibold tracking-tight text-foreground">{t("profile.abilities")}</h3>
						<span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
							<span className="h-1.5 w-1.5 rounded-full bg-primary" />
							{t("profile.abilityCount", { selected: selectedCount, total: configurableCapabilities.length })}
						</span>
					</div>
					<p className="mt-1 text-xs text-muted-foreground/70">
						{t("profile.abilitiesHint")}
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="h-8 gap-1.5 rounded-lg border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-colors"
					onClick={() => onChange(selectAllAgentAbilities(configurableCapabilities))}
				>
					<span className="icon-[solar--checklist-minimalistic-linear] h-3.5 w-3.5 text-primary" aria-hidden="true" />
					<span className="text-xs font-medium">{t("profile.selectAll")}</span>
				</Button>
			</div>

			<div className="border-b border-border/50 bg-card/10 p-3.5">
				<div className="relative">
					<span
						className="icon-[solar--magnifer-linear] pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
						aria-hidden="true"
					/>
					<Input
						name="agent-capability-search"
						autoComplete="off"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("profile.searchAbilities")}
						aria-label={t("profile.searchAbilities")}
						className="h-9.5 rounded-xl border-border/60 bg-background/50 pl-9 text-sm transition-all focus:border-primary/50 focus:bg-background"
					/>
				</div>
			</div>

			{visibleCapabilities.length > 0 ? (
				<GroupedVirtuoso
					style={{ height: Math.min(480, grouped.length * 36 + visibleCapabilities.length * 68) }}
					groupCounts={grouped.map((group) => group.items.length)}
					groupContent={(index) => (
						<div className="border-b border-border/30 bg-card/95 px-6 py-2 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/80 backdrop-blur-md">
							{grouped[index]?.label}
						</div>
					)}
					itemContent={(index) => {
						const option = visibleCapabilities[index];
						return option ? (
							<CapabilityToggle
								option={option}
								checked={isAgentAbilitySelected(abilities, option)}
								onToggle={() =>
									onChange(toggleAgentAbility(abilities, option, capabilities))
								}
							/>
						) : null;
					}}
				/>
			) : (
				<p className="px-4 py-12 text-center text-xs text-muted-foreground/70">
					{query ? t("profile.noMatchingAbilities") : t("profile.noInstalledAbilities")}
				</p>
			)}

			<div className="flex items-center gap-2 border-t border-border/40 bg-card/15 px-6 py-3 text-[11px] text-muted-foreground/60">
				<span className="icon-[solar--info-circle-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				<span>{t("profile.abilityIdsHint")}</span>
			</div>
		</section>
	);
}

function CapabilityToggle({
	option,
	checked,
	onToggle,
}: {
	readonly option: AgentCapabilityOption;
	readonly checked: boolean;
	readonly onToggle: () => void;
}): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return (
		<div className="flex min-w-0 items-center gap-3.5 border-b border-border/30 px-6 py-3 transition-colors hover:bg-muted/30 last:border-b-0">
			<AbilityIcon
				icon={option.icon}
				type={option.kind}
				className="h-9.5 w-9.5 rounded-xl border border-border/50"
				iconClassName="h-4.5 w-4.5"
			/>
			<div className="min-w-0 flex-1 text-xs">
				<span className="block truncate text-sm font-medium text-foreground">{option.title}</span>
				<span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
					{option.description || option.id}
				</span>
				{!option.enabledGlobally && (
					<span className="mt-1 inline-flex items-center gap-1 text-[11px] text-warning">
						<span className="icon-[solar--shield-warning-linear] h-3 w-3" aria-hidden="true" />
						{t("profile.globalDisabled")}
					</span>
				)}
			</div>
			<Switch
				checked={checked}
				disabled={!option.enabledGlobally}
				onCheckedChange={onToggle}
				aria-label={t("profile.toggleAbility", { name: option.title })}
			/>
		</div>
	);
}

function TextField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
}): JSX.Element {
	return (
		<label className="text-sm">
			<span className="mb-1.5 block text-xs font-semibold tracking-wider uppercase text-muted-foreground/80">
				{label}
			</span>
			<Input
				name={label}
				autoComplete="off"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-10 rounded-xl border-border/60 bg-background/50 px-3.5 text-sm transition-all hover:border-border focus:border-primary/50 focus:bg-background"
			/>
		</label>
	);
}
