import type { AgentAbilitySelection, AgentBlueprint, AgentProfile, AgentProfileUpdateImpact } from "@vetta/agent-team";
import { Button, Input, Switch } from "@vetta/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GroupedVirtuoso } from "react-virtuoso";
import type { AgentProfileEditInput } from "../hooks/useAgentLibraryModel";
import type { AgentCapabilityOption } from "../lib/capability-options";
import {
	isAgentAbilitySelected,
	selectAllAgentAbilities,
	toggleAgentAbility,
} from "../lib/ability-selection";
import { AbilityIcon } from "../../abilities/components/AbilityIcon";
import { agentAvatarUrl } from "../../../shared/agent-teams/agent-avatar";
import { AgentAvatarPicker } from "./AgentAvatarPicker";

interface AgentProfileEditorProps {
	readonly agent: AgentProfile;
	readonly blueprint?: AgentBlueprint;
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly displayName?: string;
	readonly displayDescription?: string;
	/** External save requests are used by the Team settings page to keep one save action for all drafts. */
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
	saveRequest,
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
	const [abilities, setAbilities] = useState<AgentAbilitySelection>(agent.abilities);
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
		setAbilities(agent.abilities);
		setPendingImpact(undefined);
		setSaved(false);
		setError(undefined);
	}, [agent, displayDescription, displayName]);

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

	return (
		<div className="mx-auto max-w-4xl space-y-6 pb-12">
			{/* Member Identity Hero Banner */}
			<div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-card/70 via-card/40 to-background/40 p-6 backdrop-blur-sm">
				<div className="flex flex-wrap items-center gap-5">
					<div className="relative shrink-0">
						<div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-muted/30 p-2">
							<img src={avatar} alt="" className="h-full w-full object-contain" />
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
	const groups: readonly { kind: AgentCapabilityOption["kind"]; label: string }[] = [
		{ kind: "skill", label: t("profile.skills") },
		{ kind: "scene", label: t("profile.scenes") },
		{ kind: "mcp", label: t("profile.mcp") },
		{ kind: "plugin", label: t("profile.plugins") },
	];
	const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase();
	const grouped = groups
		.map((group) => ({
			...group,
			items: capabilities.filter(
				(option) =>
					option.kind === group.kind &&
					(!normalizedQuery ||
						`${option.title}\n${option.description}\n${option.id}`
							.normalize("NFKC")
							.toLocaleLowerCase()
							.includes(normalizedQuery)),
			),
		}))
		.filter((group) => group.items.length > 0);
	const visibleCapabilities = grouped.flatMap((group) => group.items);
	const selectedCount = capabilities.filter((option) => isAgentAbilitySelected(abilities, option)).length;
	return (
		<section className="overflow-hidden rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm">
			<div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/50 bg-card/20 px-6 py-4">
				<div>
					<div className="flex flex-wrap items-center gap-2.5">
						<span className="icon-[solar--bolt-circle-linear] h-4 w-4 text-primary" aria-hidden="true" />
						<h3 className="text-sm font-semibold tracking-tight text-foreground">{t("profile.abilities")}</h3>
						<span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
							<span className="h-1.5 w-1.5 rounded-full bg-primary" />
							{t("profile.abilityCount", { selected: selectedCount, total: capabilities.length })}
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
					onClick={() => onChange(selectAllAgentAbilities(capabilities))}
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
