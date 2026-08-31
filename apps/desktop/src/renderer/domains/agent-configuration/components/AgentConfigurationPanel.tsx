import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import { Textarea } from "@shared/components/ui/textarea";
import { hostApi } from "@shared/host-api";
import { newSessionAgentConfigurationAtom, reasoningByModelAtom, selectedModelAtom } from "@shared/store/atoms";
import type {
	AgentConfiguration,
	AgentConfigurationSelection,
	AgentConfigurationTemplate,
} from "@vetta/coding-agent/profile";
import { DEFAULT_AGENT_CONFIGURATION } from "@vetta/coding-agent/profile";
import type {
	AgentConfigurationResourceCatalog,
	AgentConfigurationStatus,
} from "@vetta/coding-agent/session-extensions";
import { useAtom, useStore } from "jotai";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { editAgentConfiguration } from "../services/configuration-draft";
import { ResourceSelectionField } from "./ResourceSelectionField";

const EMPTY_CATALOG: AgentConfigurationResourceCatalog = {
	skills: [],
	tools: [],
	mcpServers: [],
	plugins: [],
	models: [],
};

interface Props {
	readonly sessionId?: string;
	readonly onApplied: () => void;
}

export function AgentConfigurationPanel({ sessionId, onApplied }: Props): JSX.Element {
	const { t } = useTranslation("chat");
	const id = useId();
	const store = useStore();
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const [draft, setDraft] = useAtom(newSessionAgentConfigurationAtom);
	const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom);
	const [, setReasoningByModel] = useAtom(reasoningByModelAtom);
	const [templates, setTemplates] = useState<readonly AgentConfigurationTemplate[]>([]);
	const [template, setTemplate] = useState<AgentConfigurationTemplate | null>(null);
	const [configuration, setConfiguration] = useState<AgentConfiguration>({ ...DEFAULT_AGENT_CONFIGURATION });
	const [status, setStatus] = useState<AgentConfigurationStatus | null>(null);
	const [editingRevision, setEditingRevision] = useState(0);
	const [catalog, setCatalog] = useState(EMPTY_CATALOG);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [reload, setReload] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(false);
		void Promise.resolve()
			.then(async () => {
				const [available, sessionStatus, resources] = await Promise.all([
					hostApi.agentConfiguration.listTemplates(),
					sessionId ? hostApi.agentConfiguration.readSession(sessionId) : null,
					sessionId ? hostApi.agentConfiguration.readCatalog(sessionId) : EMPTY_CATALOG,
				]);
				if (cancelled) return;
				const selected = sessionStatus?.desired.selection ?? draft;
				setTemplates(available);
				setTemplate(selected.template);
				setName(selected.template?.name ?? "");
				setConfiguration(sessionStatus?.resolved ?? editAgentConfiguration(selected));
				setStatus(sessionStatus);
				setEditingRevision(sessionStatus?.desired.revision ?? 0);
				setCatalog(resources);
			})
			.catch(() => {
				if (!cancelled) setError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [sessionId, reload, draft]);

	useEffect(() => {
		if (!sessionId) return;
		let cancelled = false;
		const timer = setInterval(() => {
			void hostApi.agentConfiguration
				.readSession(sessionId)
				.then((next) => {
					if (!cancelled) setStatus(next);
				})
				.catch(() => {
					if (!cancelled) setError(true);
				});
		}, 2000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [sessionId]);

	const run = async (operation: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setError(false);
		try {
			await operation();
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	};
	const chooseTemplate = (templateId: string) => {
		const next = templates.find(({ id }) => id === templateId) ?? null;
		setTemplate(next);
		setName(next?.name ?? "");
		setConfiguration(next?.configuration ?? { ...DEFAULT_AGENT_CONFIGURATION });
		setConfirmDelete(false);
	};
	const saveTemplate = (copy: boolean) =>
		run(async () => {
			const saved = await hostApi.agentConfiguration.saveTemplate({
				...(copy || !template ? {} : { id: template.id }),
				expectedRevision: copy || !template ? 0 : template.revision,
				name,
				configuration,
			});
			setTemplates((items) => [...items.filter(({ id }) => id !== saved.id), saved]);
			setTemplate(saved);
			setConfirmDelete(false);
		});
	const apply = () =>
		run(async () => {
			const selection: AgentConfigurationSelection = { template, overrides: configuration };
			if (sessionId) {
				if (!status) return;
				await hostApi.agentConfiguration.updateSession(sessionId, { expectedRevision: editingRevision, selection });
			} else setDraft(selection);
			if (!mounted.current) return;
			if (configuration.modelKey) setSelectedModel(configuration.modelKey);
			const modelKey = configuration.modelKey ?? selectedModel;
			if (configuration.thinkingLevel && modelKey)
				setReasoningByModel({ ...store.get(reasoningByModelAtom), [modelKey]: configuration.thinkingLevel });
			onApplied();
		});
	const disabled = busy || loading;
	const knownTemplates =
		template && !templates.some(({ id }) => id === template.id) ? [...templates, template] : templates;

	return (
		<div className="space-y-4">
			<p className="text-[12px] text-muted-foreground">{t("agentConfiguration.description")}</p>
			{status && (
				<div role="status" className="rounded-lg border border-border/50 p-3 text-[12px]">
					{t("agentConfiguration.versions", {
						desired: status.desired.revision,
						effective: status.effectiveRevision ?? t("agentConfiguration.notApplied"),
					})}
					{status.pending && <p className="text-amber-400">{t("agentConfiguration.pending")}</p>}
					{status.failure && <p className="text-destructive">{t("agentConfiguration.applyFailed")}</p>}
					{status.desired.revision !== editingRevision && (
						<p className="text-amber-400">{t("agentConfiguration.stale")}</p>
					)}
				</div>
			)}
			{error && (
				<div role="alert" className="text-[12px] text-destructive">
					{t("agentConfiguration.error")}{" "}
					<Button variant="ghost" size="sm" disabled={busy} onClick={() => setReload((value) => value + 1)}>
						{t("agentConfiguration.reload")}
					</Button>
				</div>
			)}
			{loading && (
				<p role="status" className="text-[12px] text-muted-foreground">
					{t("agentConfiguration.loading")}
				</p>
			)}
			<div className="space-y-2">
				<label htmlFor={`${id}-template`} id={`${id}-template-label`} className="text-[13px]">
					{t("agentConfiguration.template")}
				</label>
				<Select value={template?.id ?? "host"} onValueChange={chooseTemplate} disabled={disabled}>
					<SelectTrigger id={`${id}-template`} aria-labelledby={`${id}-template-label`}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="host">{t("agentConfiguration.defaultTemplate")}</SelectItem>
						{knownTemplates.map((item) => (
							<SelectItem key={item.id} value={item.id}>
								{item.name} · v{item.revision}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{template && (
					<p className="text-[11px] text-muted-foreground">
						{t("agentConfiguration.pinnedTemplate", { revision: template.revision })}
					</p>
				)}
			</div>
			<div className="space-y-2">
				<label htmlFor={`${id}-prompt`} className="text-[13px]">
					{t("agentConfiguration.prompt")}
				</label>
				<Textarea
					id={`${id}-prompt`}
					value={configuration.appendSystemPrompt}
					maxLength={64000}
					disabled={disabled}
					onChange={(event) => setConfiguration({ ...configuration, appendSystemPrompt: event.target.value })}
					className="min-h-28 text-[13px]"
				/>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				{(["skills", "tools", "mcpServers", "plugins"] as const).map((kind) => (
					<ResourceSelectionField
						key={kind}
						kind={kind}
						value={configuration[kind]}
						available={catalog[kind]}
						disabled={disabled}
						onChange={(value) => setConfiguration({ ...configuration, [kind]: value })}
					/>
				))}
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-2">
					<label htmlFor={`${id}-model`} className="text-[13px]">
						{t("agentConfiguration.model")}
					</label>
					<Input
						id={`${id}-model`}
						list={`${id}-models`}
						value={configuration.modelKey ?? ""}
						placeholder={t("agentConfiguration.modelPlaceholder")}
						disabled={disabled}
						onChange={(event) => setConfiguration({ ...configuration, modelKey: event.target.value || null })}
					/>
					<datalist id={`${id}-models`}>
						{catalog.models.map((model) => (
							<option key={model.key} value={model.key}>
								{model.name}
							</option>
						))}
					</datalist>
				</div>
				<div className="space-y-2">
					<label htmlFor={`${id}-thinking`} id={`${id}-thinking-label`} className="text-[13px]">
						{t("agentConfiguration.thinking")}
					</label>
					<Select
						value={configuration.thinkingLevel ?? "host"}
						disabled={disabled}
						onValueChange={(value) =>
							setConfiguration({
								...configuration,
								thinkingLevel: value === "host" ? null : (value as NonNullable<AgentConfiguration["thinkingLevel"]>),
							})
						}
					>
						<SelectTrigger id={`${id}-thinking`} aria-labelledby={`${id}-thinking-label`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="host">{t("agentConfiguration.inherit")}</SelectItem>
							{(["off", "minimal", "low", "medium", "high", "xhigh"] as const).map((level) => (
								<SelectItem key={level} value={level}>
									{t(`agentConfiguration.reasoning.${level}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<p className="text-[11px] text-muted-foreground">{t("agentConfiguration.modelPriority")}</p>
			<div className="space-y-2 rounded-xl border border-border/50 p-3">
				<label htmlFor={`${id}-name`} className="text-[13px]">
					{t("agentConfiguration.templateName")}
				</label>
				<Input
					id={`${id}-name`}
					value={name}
					maxLength={128}
					disabled={disabled}
					onChange={(event) => setName(event.target.value)}
				/>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={disabled || !name.trim()}
						onClick={() => void saveTemplate(true)}
					>
						{t("agentConfiguration.saveCopy")}
					</Button>
					{template && (
						<>
							<Button
								variant="outline"
								size="sm"
								disabled={disabled || !name.trim()}
								onClick={() => void saveTemplate(false)}
							>
								{t("agentConfiguration.updateTemplate")}
							</Button>
							<Button variant="destructive" size="sm" disabled={disabled} onClick={() => setConfirmDelete(true)}>
								{t("agentConfiguration.deleteTemplate")}
							</Button>
						</>
					)}
				</div>
				{confirmDelete && template && (
					<div className="space-y-2 text-[12px]">
						<p>{t("agentConfiguration.deleteNotice")}</p>
						<Button
							variant="destructive"
							size="sm"
							disabled={disabled}
							onClick={() =>
								void run(async () => {
									await hostApi.agentConfiguration.deleteTemplate(template.id, template.revision);
									setTemplates((items) => items.filter(({ id }) => id !== template.id));
									setTemplate(null);
									setConfirmDelete(false);
								})
							}
						>
							{t("agentConfiguration.confirmDelete")}
						</Button>{" "}
						<Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
							{t("agentConfiguration.cancel")}
						</Button>
					</div>
				)}
			</div>
			<div className="flex justify-end gap-2">
				<Button
					variant="outline"
					disabled={disabled}
					onClick={() => setConfiguration(template?.configuration ?? { ...DEFAULT_AGENT_CONFIGURATION })}
				>
					{t("agentConfiguration.resetOverrides")}
				</Button>
				<Button
					variant="primary"
					disabled={disabled || (sessionId !== undefined && status === null)}
					onClick={() => void apply()}
				>
					{t(sessionId ? "agentConfiguration.applyNextTurn" : "agentConfiguration.useForNewSession")}
				</Button>
			</div>
		</div>
	);
}
