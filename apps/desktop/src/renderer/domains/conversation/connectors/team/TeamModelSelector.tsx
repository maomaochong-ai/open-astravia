import { useSetAtom } from "jotai";
import { selectedModelAtom, modelSupportsImagesAtom } from "@shared/store/atoms";
import { persistSelectedModel } from "../../hooks/useModelSelectorModel";
import { useTeamMemberModels } from "@shared/agent-teams/useTeamMemberModels";
import { resolveReasoning } from "@shared/components/ModelSelect/resolveReasoning";
import { useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import { Button } from "@shared/components/ui/button";
import { InlineModelPicker, ModelConfigurationPopover, ModelConfigurationOverview } from "@vetta-org/theme-ui/chat";
import type { ModelConfigurationGroup } from "@vetta-org/theme-ui/chat";
import { fmtMultiplier } from "@vetta-org/theme-ui/shared";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import { modelCatalog } from "@shared/store/model-catalog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveTeamMemberModel } from "../../../../../shared/agent-team-member-model";
import type { TeamChatActions, TeamComposerViewModel } from "./teamChatModel";

/** Preferences belong to the team; the fallback model belongs to this conversation. */
export function TeamModelSelector({
	model,
	actions,
}: {
	readonly model: TeamComposerViewModel;
	readonly actions: Pick<TeamChatActions, "selectModel" | "selectReasoning">;
}): JSX.Element {
	const { t } = useTranslation(["agent-teams", "common"]);
	const { state, select, reload } = useTeamMemberModels(model.teamId);
	const { options, grouped, defaultKey, iconFor, labelFor } = useModelOptions();
	const [open, setOpen] = useState(false);
	const [target, setTarget] = useState<{ kind: "default" } | { kind: "member"; id: string }>();
	const [returnFocus, setReturnFocus] = useState<string>();
	const back = () => {
		setReturnFocus(target?.kind === "member" ? `member:${target.id}` : "default");
		setTarget(undefined);
	};
	useEffect(() => {
		if (open) void modelCatalog.revalidate();
	}, [open]);
	const rememberModel = useSetAtom(selectedModelAtom);
	const setSupportsImages = useSetAtom(modelSupportsImagesAtom);
	const catalogOption = options.find((option) => option.key === model.modelKey);
	useEffect(() => {
		if (options.length > 0) setSupportsImages(catalogOption?.supportsImage ?? false);
	}, [options.length, catalogOption, setSupportsImages]);
	const [defaultSaving, setDefaultSaving] = useState(false);
	const [defaultError, setDefaultError] = useState<string>();
	const savingRef = useRef(false);
	const initializedRef = useRef<string | undefined>(undefined);
	const updateDefault = useCallback(async (update: () => Promise<void>) => {
		if (savingRef.current) return;
		savingRef.current = true;
		setDefaultSaving(true);
		setDefaultError(undefined);
		try {
			await update();
		} catch (cause) {
			setDefaultError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			savingRef.current = false;
			setDefaultSaving(false);
		}
	}, []);
	const selectDefault = useCallback(
		(key: string) =>
			updateDefault(async () => {
				await actions.selectModel(key, resolveReasoning(options.find((option) => option.key === key))?.default);
				rememberModel(key);
				persistSelectedModel(key);
			}),
		[actions, options, rememberModel, updateDefault],
	);
	useEffect(() => {
		if (model.modelKey || !defaultKey) return;
		const identity = `${model.teamId}:${model.activeSessionId ?? "new"}:${defaultKey}`;
		if (initializedRef.current === identity) return;
		initializedRef.current = identity;
		void selectDefault(defaultKey);
	}, [defaultKey, model.activeSessionId, model.modelKey, model.teamId, selectDefault]);

	const preferences = state?.models;
	const fixedCount = model.members.filter((member) => preferences?.[member.id]).length;
	const nameFor = (key?: string | null) =>
		options.find((option) => option.key === key)?.displayName ?? key ?? t("common:modelSelect.placeholder");
	const unavailable = (key?: string | null) =>
		Boolean(key && options.length > 0 && !options.some((option) => option.key === key));
	const triggerLabel = !preferences
		? t("common:modelSelect.placeholder")
		: fixedCount > 0
			? t("models.configured")
			: nameFor(model.modelKey);
	const disabled = !preferences || Boolean(state?.saving || state?.loading);

	const levelLabel = (level: string) => t(`common:modelSelect.reasoningLevel.${level}`, { defaultValue: level });
	const reasoningFor = (key: string | undefined, value: string | undefined) => {
		const resolved = resolveReasoning(options.find((option) => option.key === key));
		return resolved ? (value ?? resolved.default) : undefined;
	};
	const groups = new Map<string, { group: ModelConfigurationGroup; levels: Set<string>; fixed: number }>();
	for (const member of model.members) {
		const preference = preferences?.[member.id];
		const effective = resolveTeamMemberModel({
			preference,
			agentProfileId: preference?.agentProfileId,
			sessionModelKey: model.modelKey ?? undefined,
			sessionReasoning: model.reasoning,
		});
		const key = effective.modelKey ?? "";
		const level = reasoningFor(effective.modelKey, effective.reasoning);
		const name = member.name || `@${member.handle}`;
		const entry = groups.get(key) ?? {
			group: {
				key,
				label: nameFor(key || undefined),
				members: [],
				usageLabel: "",
				unavailable: unavailable(key) ? t("models.unavailable", { model: nameFor(key) }) : undefined,
			},
			levels: new Set<string>(),
			fixed: 0,
		};
		entry.levels.add(level ? levelLabel(level) : "");
		if (preference) entry.fixed += 1;
		const selectionLabel = preference ? nameFor(key) : t("settings.memberModelInherit");
		entry.group = {
			...entry.group,
			members: [
				...entry.group.members,
				{
					id: member.id,
					name,
					avatar: agentAvatarUrl(member),
					selectionLabel,
					selectionDetail: level ? t("models.reasoning", { level: levelLabel(level) }) : undefined,
					editLabel: t("models.memberLabel", { member: name }),
				},
			],
		};
		groups.set(key, entry);
	}
	const viewGroups = [...groups.values()].map(({ group, levels, fixed }) => ({
		...group,
		detail:
			levels.size > 1
				? t("models.mixedReasoning")
				: [...levels][0]
					? t("models.reasoning", { level: [...levels][0] })
					: undefined,
		usageLabel: [
			fixed > 0 ? t("models.fixedCount", { count: fixed }) : undefined,
			levels.size > 1 && fixedCount < model.members.length && group.key === model.modelKey
				? t("models.mixedReasoning")
				: undefined,
		]
			.filter(Boolean)
			.join(" · "),
	}));
	const triggerModelKey =
		viewGroups.length === 1 ? viewGroups[0]?.key : model.members.length === 0 ? model.modelKey : undefined;
	const triggerProvider = triggerModelKey?.split("/")[0];
	const defaultLevel = reasoningFor(model.modelKey ?? undefined, model.reasoning);
	const selectedMember =
		target?.kind === "member" ? model.members.find((member) => member.id === target.id) : undefined;
	useEffect(() => {
		if (target?.kind === "member" && !selectedMember) setTarget(undefined);
	}, [target, selectedMember]);
	const pinned = selectedMember ? preferences?.[selectedMember.id] : undefined;
	const selectedKey = selectedMember ? pinned?.modelKey : (model.modelKey ?? undefined);
	const selectedReasoning = selectedMember ? pinned?.reasoning : model.reasoning;
	const resolved = resolveReasoning(options.find((option) => option.key === selectedKey));
	const levels = !resolved
		? []
		: resolved.levels.includes("none")
			? ["none", ...resolved.levels.filter((level) => level !== "none" && level !== "off")]
			: ["off", ...resolved.levels.filter((level) => level !== "off")];
	const busy = disabled || defaultSaving || (target?.kind === "member" && !selectedMember);
	const editorTitle = selectedMember
		? t("models.memberLabel", { member: selectedMember.name || `@${selectedMember.handle}` })
		: t("models.default");

	return (
		<ModelConfigurationPopover
			triggerLabel={triggerLabel}
			triggerIcon={triggerProvider ? iconFor(triggerProvider) : undefined}
			title={t("models.title")}
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setTarget(undefined);
					setReturnFocus(undefined);
				}
			}}
			onBack={target ? back : undefined}
		>
			{target ? (
				<InlineModelPicker
					key={target.kind === "member" ? target.id : "default"}
					title={editorTitle}
					avatar={
						selectedMember
							? { src: agentAvatarUrl(selectedMember), alt: selectedMember.name || `@${selectedMember.handle}` }
							: undefined
					}
					description={
						selectedMember
							? t("models.memberScopeHint")
							: t("models.defaultHint", { count: model.members.length - fixedCount })
					}
					status={state?.loading ? t("models.loading") : undefined}
					backLabel={t("models.back")}
					onBack={back}
					groups={[...grouped].map(([provider, models]) => ({
						provider,
						models,
						label: labelFor(provider),
						icon: iconFor(provider),
					}))}
					selectedModel={selectedKey}
					defaultKey={defaultKey}
					disabled={busy}
					labels={{
						placeholder: t("common:modelSelect.placeholder"),
						searchPlaceholder: t("common:modelSelect.searchPlaceholder"),
						clearSearch: t("common:modelSelect.clearSearch"),
						noResults: t("common:modelSelect.noResults"),
						noResultsHint: t("common:modelSelect.noResultsHint"),
						reasoningHeader: t("common:modelSelect.reasoningHeader"),
						modelHeader: t("common:modelSelect.modelHeader"),
						cloudOnly: t("common:modelSelect.cloudOnly"),
						visionBadge: t("common:modelSelect.visionBadge"),
						defaultBadge: t("common:modelSelect.defaultBadge"),
						levelLabel,
						multiplierLabel: (option) => {
							const multiplier = options.find((candidate) => candidate.key === option.key)?.multiplier;
							return multiplier
								? multiplier.input === 0 && multiplier.output === 0
									? t("common:modelSelect.free")
									: t("common:modelSelect.multiplier", { value: fmtMultiplier(multiplier.input) })
								: undefined;
						},
					}}
					onModelSelect={(key) => {
						if (selectedMember)
							void select(selectedMember.id, {
								modelKey: key,
								reasoning: resolveReasoning(options.find((option) => option.key === key))?.default,
							});
						else void selectDefault(key);
					}}
					inheritance={
						selectedMember
							? {
									label: t("settings.memberModelInherit"),
									selected: !pinned,
									disabled: !pinned && !model.modelKey,
									onChange: (checked) => {
										if (checked) void select(selectedMember.id, null);
										else if (model.modelKey)
											void select(selectedMember.id, { modelKey: model.modelKey, reasoning: model.reasoning });
									},
								}
							: undefined
					}
					reasoning={
						resolved && selectedKey
							? {
									value: selectedReasoning ?? resolved.default,
									levels,
									onChange: (value) => {
										if (selectedMember) return select(selectedMember.id, { modelKey: selectedKey, reasoning: value });
										return updateDefault(() => actions.selectReasoning(value));
									},
								}
							: undefined
					}
				/>
			) : null}
			{preferences ? (
				<div hidden={Boolean(target)}>
					<ModelConfigurationOverview
						groups={viewGroups}
						defaultKey={model.modelKey ?? ""}
						defaultInUse={fixedCount < model.members.length}
						disabled={busy}
						title={t("models.title")}
						defaultModelLabel={nameFor(model.modelKey)}
						defaultDetail={defaultLevel ? t("models.reasoning", { level: levelLabel(defaultLevel) }) : undefined}
						defaultUnavailable={
							unavailable(model.modelKey) ? t("models.unavailable", { model: nameFor(model.modelKey) }) : undefined
						}
						defaultLabel={t("models.default")}
						defaultHint={t("models.defaultHint", { count: model.members.length - fixedCount })}
						customLabel={t("models.custom")}
						expandLabel={t("models.expand")}
						collapseLabel={t("models.collapse")}
						returnFocus={target ? undefined : returnFocus}
						onDefaultSelect={() => setTarget({ kind: "default" })}
						onMemberSelect={(id) => setTarget({ kind: "member", id })}
					/>
				</div>
			) : (
				<h2 className="text-[13px] font-medium">{t("models.title")}</h2>
			)}
			{!target && state?.loading ? (
				<p role="status" className="mt-2 text-[12px] text-muted-foreground">
					{t("models.loading")}
				</p>
			) : null}
			{!target && (state?.saving || defaultSaving) ? (
				<p role="status" className="mt-2 text-[12px] text-muted-foreground">
					{t("models.saving")}
				</p>
			) : null}
			{state?.error ? (
				<div role="alert" className="mt-2 text-[12px] text-destructive">
					<p>{t("models.loadOrSaveError", { error: state.error })}</p>
					<Button variant="ghost" size="sm" onClick={() => void reload()}>
						{t("models.retry")}
					</Button>
				</div>
			) : null}
			{defaultError ? (
				<p role="alert" className="mt-2 text-[12px] text-destructive">
					{defaultError}
				</p>
			) : null}
			{target && unavailable(selectedKey) ? (
				<p role="status" className="mt-2 text-[11px] text-destructive">
					{t("models.unavailable", { model: nameFor(selectedKey) })}
				</p>
			) : null}
		</ModelConfigurationPopover>
	);
}
