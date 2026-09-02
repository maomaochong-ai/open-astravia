import type { AgentAbilitySelection, AgentBlueprint, AgentProfile, AgentProfileUpdateImpact } from "@vetta/agent-team";
import { Button, Input, Switch } from "@vetta/ui";
import { useEffect, useState } from "react";
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

interface AgentProfileEditorProps {
	readonly agent: AgentProfile;
	readonly blueprint?: AgentBlueprint;
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly displayName?: string;
	readonly displayDescription?: string;
	readonly identityReadOnly?: boolean;
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
	identityReadOnly = false,
	onPreview,
	onSave,
}: AgentProfileEditorProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const [name, setName] = useState(displayName ?? agent.name);
	const [description, setDescription] = useState(displayDescription ?? agent.description);
	const [abilities, setAbilities] = useState<AgentAbilitySelection>(agent.abilities);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [pendingImpact, setPendingImpact] = useState<AgentProfileUpdateImpact>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		setName(displayName ?? agent.name);
		setDescription(displayDescription ?? agent.description);
		setAbilities(agent.abilities);
		setPendingImpact(undefined);
		setSaved(false);
		setError(undefined);
	}, [agent, displayDescription, displayName]);

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
				name: identityReadOnly ? agent.name : name,
				description: identityReadOnly ? agent.description : description,
				mentionHandle: agent.mentionHandle,
				abilities,
			});
			setPendingImpact(undefined);
			setSaved(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="mx-auto max-w-3xl">
			<header className="mb-8">
				<h2 className="text-2xl font-bold">{displayName ?? agent.name}</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					{t("profile.fixedPrompt", {
						role: blueprint ? t(blueprint.nameKey as never) : agent.blueprintId,
					})}
				</p>
			</header>

			<div className="flex flex-col gap-5">
				<TextField
					label={t("profile.name")}
					value={name}
					readOnly={identityReadOnly}
					onChange={setName}
				/>
				<label className="text-sm">
					<span className="mb-1 block text-muted-foreground">{t("profile.description")}</span>
					<textarea
						value={description}
						readOnly={identityReadOnly}
						onChange={(event) => setDescription(event.target.value)}
						className="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 outline-none transition-shadow focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
					/>
				</label>
				<AbilityEditor
					abilities={abilities}
					capabilities={capabilities}
					onChange={setAbilities}
				/>
				{pendingImpact && pendingImpact.teamIds.length > 1 && (
					<div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
						{t("profile.sharedImpact", {
							count: pendingImpact.teamIds.length,
							teams: pendingImpact.teamNames.join("、"),
						})}
						<div className="mt-2">
							<Button variant="ghost" size="sm" onClick={() => void save()}>
								{t("profile.confirmSharedSave")}
							</Button>
						</div>
					</div>
				)}
				<div className="flex items-center gap-3">
					<Button variant="primary" disabled={saving} onClick={() => void save()}>
						{saving ? t("profile.saving") : t("profile.save")}
					</Button>
					<span aria-live="polite" className="text-xs text-muted-foreground">
						{saved ? t("profile.savedNextTurn") : ""}
					</span>
					{error && (
						<span aria-live="polite" className="text-xs text-destructive">
							{error}
						</span>
					)}
				</div>
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
		<section className="overflow-hidden rounded-xl border border-border/70 bg-card/20">
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
				<div>
					<h3 className="text-sm font-semibold">{t("profile.abilities")}</h3>
					<p className="mt-0.5 text-xs text-muted-foreground/70">
						{t("profile.abilityCount", { selected: selectedCount, total: capabilities.length })}
					</p>
					<p className="mt-1 max-w-md text-[11px] text-muted-foreground/60">
						{t("profile.abilitiesHint")}
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onChange(selectAllAgentAbilities(capabilities))}
				>
					<span className="icon-[solar--checklist-minimalistic-linear] h-4 w-4" aria-hidden="true" />
					{t("profile.selectAll")}
				</Button>
			</div>
			<div className="border-b border-border/60 p-3">
				<div className="relative">
					<span
						className="icon-[solar--magnifer-linear] pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50"
						aria-hidden="true"
					/>
					<Input
						name="agent-capability-search"
						autoComplete="off"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("profile.searchAbilities")}
						aria-label={t("profile.searchAbilities")}
						className="h-9 pl-8"
					/>
				</div>
			</div>
			{visibleCapabilities.length > 0 ? (
				<GroupedVirtuoso
					style={{ height: Math.min(448, grouped.length * 32 + visibleCapabilities.length * 64) }}
					groupCounts={grouped.map((group) => group.items.length)}
					groupContent={(index) => (
						<div className="bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur">
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
				<p className="px-4 py-10 text-center text-xs text-muted-foreground/70">
					{query ? t("profile.noMatchingAbilities") : t("profile.noInstalledAbilities")}
				</p>
			)}
			<p className="border-t border-border/40 px-4 py-3 text-[11px] text-muted-foreground/60">
				{t("profile.abilityIdsHint")}
			</p>
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
		<div className="flex min-w-0 items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0">
			<AbilityIcon
				icon={option.icon}
				type={option.kind}
				className="h-9 w-9 rounded-lg"
				iconClassName="h-4.5 w-4.5"
			/>
			<div className="min-w-0 flex-1 text-xs">
				<span className="block truncate font-medium">{option.title}</span>
				<span className="mt-0.5 block truncate text-muted-foreground">
					{option.description || option.id}
				</span>
				{!option.enabledGlobally && <span className="mt-1 block text-warning">{t("profile.globalDisabled")}</span>}
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
	readOnly = false,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly readOnly?: boolean;
	readonly onChange: (value: string) => void;
}): JSX.Element {
	return (
		<label className="text-sm">
			<span className="mb-1 block text-muted-foreground">{label}</span>
			<Input
				name={label}
				autoComplete="off"
				value={value}
				readOnly={readOnly}
				onChange={(event) => onChange(event.target.value)}
				className="h-9"
			/>
		</label>
	);
}
