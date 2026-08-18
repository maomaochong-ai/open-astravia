import type {
	WebhookCreateInput,
	WebhookEndpointPublic,
	WebhookKind,
	WebhookProviderDescriptor,
	WebhookUpdatePatch,
} from "@preload/api";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface WebhookFormState {
	dingtalkAtMobiles: string;
	dingtalkKeyword: string;
	dingtalkMentionAll: boolean;
	feishuMentionAll: boolean;
	kind: WebhookKind;
	name: string;
	signSecret: string;
	webhookUrl: string;
}

export interface WebhookRowMessage {
	ok: boolean;
	text: string;
}

export interface WebhookSettingsModel {
	actions: {
		closeEditor: (open: boolean) => void;
		deleteEndpoint: (endpoint: WebhookEndpointPublic) => Promise<void>;
		openCreate: () => void;
		openEdit: (endpoint: WebhookEndpointPublic) => void;
		submit: () => Promise<void>;
		testEndpoint: (endpoint: WebhookEndpointPublic) => Promise<void>;
		toggleEndpoint: (endpoint: WebhookEndpointPublic, next: boolean) => Promise<void>;
		updateFormField: <K extends keyof WebhookFormState>(key: K, value: WebhookFormState[K]) => void;
	};
	editorError: string | null;
	editorOpen: boolean;
	editingId: string | null;
	endpoints: WebhookEndpointPublic[];
	form: WebhookFormState;
	labels: WebhookSettingsLabels;
	loading: boolean;
	narrow: boolean;
	providerByKind: Map<WebhookKind, WebhookProviderDescriptor>;
	providers: WebhookProviderDescriptor[];
	rowMessage: Record<string, WebhookRowMessage>;
	saving: boolean;
	testingId: string | null;
}

export interface WebhookSettingsLabels {
	add: string;
	addHint: string;
	addTitle: string;
	atAll: string;
	atAllDesc: string;
	atAllPerm: string;
	atPhone: string;
	atPhoneSuffix: string;
	cancel: string;
	channelLocked: string;
	channelType: string;
	channels: string;
	delete: string;
	deleteConfirm: (name: string) => string;
	description: string;
	edit: string;
	editHint: string;
	editTitle: string;
	empty: string;
	hide: string;
	keyword: string;
	keywordDesc: string;
	keywordPlaceholder: string;
	loading: string;
	name: string;
	namePlaceholder: string;
	save: string;
	saving: string;
	secret: string;
	secretHint: string;
	sectionChannels: string;
	sendFailed: string;
	sending: string;
	show: string;
	sign: string;
	switchFailed: string;
	test: string;
	testSent: string;
	testing: string;
	title: string;
	url: string;
	urlEditHint: string;
	urlRequired: string;
}

function emptyForm(kind: WebhookKind): WebhookFormState {
	return {
		kind,
		name: "",
		webhookUrl: "",
		signSecret: "",
		feishuMentionAll: false,
		dingtalkMentionAll: false,
		dingtalkAtMobiles: "",
		dingtalkKeyword: "",
	};
}

function formFromEndpoint(endpoint: WebhookEndpointPublic): WebhookFormState {
	return {
		kind: endpoint.kind,
		name: endpoint.name,
		webhookUrl: "",
		signSecret: "",
		feishuMentionAll: Boolean(endpoint.feishu?.mentionAll),
		dingtalkMentionAll: Boolean(endpoint.dingtalk?.mentionAll),
		dingtalkAtMobiles: endpoint.dingtalk?.atMobiles?.join(", ") ?? "",
		dingtalkKeyword: endpoint.dingtalk?.keyword ?? "",
	};
}

function parseMobiles(raw: string): string[] {
	return raw
		.split(/[,，\s]+/)
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

export function useWebhookSettingsModel(): WebhookSettingsModel {
	const { t } = useTranslation("settings");
	const [endpoints, setEndpoints] = useState<WebhookEndpointPublic[]>([]);
	const [providers, setProviders] = useState<WebhookProviderDescriptor[]>([]);
	const [loading, setLoading] = useState(true);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [form, setForm] = useState<WebhookFormState>(emptyForm("feishu"));
	const [editorError, setEditorError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [rowMessage, setRowMessage] = useState<Record<string, WebhookRowMessage>>({});
	const narrow = useNarrowScreen();

	const refresh = useCallback(async () => {
		const [list, providerList] = await Promise.all([
			window.vetta.webhook.list(),
			window.vetta.webhook.listProviders(),
		]);
		setEndpoints(list);
		setProviders(providerList);
	}, []);

	useEffect(() => {
		void (async () => {
			await refresh();
			setLoading(false);
		})();
	}, [refresh]);

	const localizedProviders = useMemo(
		() =>
			providers.map((p) => ({
				...p,
				displayName: p.kind === "feishu" ? t("whFeishu") : p.kind === "dingtalk" ? t("whDingtalk") : p.displayName,
			})),
		[providers, t],
	);

	const providerByKind = useMemo(() => {
		const map = new Map<WebhookKind, WebhookProviderDescriptor>();
		for (const provider of localizedProviders) map.set(provider.kind, provider);
		return map;
	}, [localizedProviders]);

	const openCreate = useCallback(() => {
		setEditingId(null);
		setForm(emptyForm(providers[0]?.kind ?? "feishu"));
		setEditorError(null);
		setEditorOpen(true);
	}, [providers]);

	const openEdit = useCallback((endpoint: WebhookEndpointPublic) => {
		setEditingId(endpoint.id);
		setForm(formFromEndpoint(endpoint));
		setEditorError(null);
		setEditorOpen(true);
	}, []);

	const handleToggle = useCallback(
		async (endpoint: WebhookEndpointPublic, next: boolean) => {
			const result = await window.vetta.webhook.toggle(endpoint.id, next);
			if (!result.ok) {
				setRowMessage((prev) => ({
					...prev,
					[endpoint.id]: { ok: false, text: result.error ?? t("whSwitchFailed") },
				}));
				return;
			}
			await refresh();
			recordSettingsUsage({
				tab: "webhook",
				action: next ? "enabled" : "disabled",
				target: "endpoint",
				value: endpoint.kind,
			});
		},
		[refresh, t],
	);

	const handleDelete = useCallback(
		async (endpoint: WebhookEndpointPublic) => {
			if (!window.confirm(t("whDeleteConfirm", { name: endpoint.name }))) return;
			await window.vetta.webhook.delete(endpoint.id);
			await refresh();
			recordSettingsUsage({ tab: "webhook", action: "deleted", target: "endpoint", value: endpoint.kind });
		},
		[refresh, t],
	);

	const handleTest = useCallback(
		async (endpoint: WebhookEndpointPublic) => {
			setTestingId(endpoint.id);
			setRowMessage((prev) => ({ ...prev, [endpoint.id]: { ok: true, text: t("whSending") } }));
			try {
				const result = await window.vetta.webhook.test(endpoint.id);
				setRowMessage((prev) => ({
					...prev,
					[endpoint.id]: {
						ok: result.ok,
						text: result.ok ? t("whTestSent") : (result.error ?? t("whSendFailed")),
					},
				}));
				recordSettingsUsage({ tab: "webhook", action: "tested", target: "endpoint", value: endpoint.kind });
			} finally {
				setTestingId(null);
			}
		},
		[t],
	);

	const updateFormField = useCallback(<K extends keyof WebhookFormState>(key: K, value: WebhookFormState[K]) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	}, []);

	const handleSubmit = useCallback(async () => {
		const url = form.webhookUrl.trim();
		const name = form.name.trim() || providerByKind.get(form.kind)?.displayName || t("whName");

		if (!editingId && !url) {
			setEditorError(t("whUrlRequired"));
			return;
		}

		const kindOpts: Pick<WebhookCreateInput, "feishu" | "dingtalk"> =
			form.kind === "feishu"
				? { feishu: { mentionAll: form.feishuMentionAll } }
				: {
						dingtalk: {
							mentionAll: form.dingtalkMentionAll,
							atMobiles: parseMobiles(form.dingtalkAtMobiles),
							keyword: form.dingtalkKeyword.trim() || undefined,
						},
					};

		setSaving(true);
		setEditorError(null);
		try {
			if (editingId) {
				const patch: WebhookUpdatePatch = {
					name,
					...kindOpts,
				};
				if (url) patch.webhookUrl = url;
				if (form.signSecret !== "") patch.signSecret = form.signSecret;
				const result = await window.vetta.webhook.update(editingId, patch);
				if (!result.ok) {
					setEditorError(result.error ?? t("whSaveFailed"));
					return;
				}
				recordSettingsUsage({ tab: "webhook", action: "updated", target: "endpoint", value: form.kind });
			} else {
				const input: WebhookCreateInput = {
					kind: form.kind,
					name,
					webhookUrl: url,
					signSecret: form.signSecret.trim() || undefined,
					enabled: true,
					...kindOpts,
				};
				const result = await window.vetta.webhook.create(input);
				if (!result.ok) {
					setEditorError(result.error ?? t("whCreateFailed"));
					return;
				}
				recordSettingsUsage({ tab: "webhook", action: "added", target: "endpoint", value: form.kind });
			}
			await refresh();
			setEditorOpen(false);
		} finally {
			setSaving(false);
		}
	}, [editingId, form, providerByKind, refresh, t]);

	const labels = useMemo<WebhookSettingsLabels>(
		() => ({
			add: t("whAdd"),
			addHint: t("whAddHint"),
			addTitle: t("whAddTitle"),
			atAll: t("whAtAll"),
			atAllDesc: t("whAtAllDesc"),
			atAllPerm: t("whAtAllPerm"),
			atPhone: t("whAtPhone"),
			atPhoneSuffix: t("whAtPhoneSuffix"),
			cancel: t("whCancel"),
			channelLocked: t("whChannelLocked"),
			channelType: t("whChannelType"),
			channels: t("whChannels"),
			delete: t("whDelete"),
			deleteConfirm: (name) => t("whDeleteConfirm", { name }),
			description: t("whDesc"),
			edit: t("whEdit"),
			editHint: t("whEditHint"),
			editTitle: t("whEditTitle"),
			empty: t("whEmpty"),
			hide: t("whHide"),
			keyword: t("whKeyword"),
			keywordDesc: t("whKeywordDesc"),
			keywordPlaceholder: t("whKeywordPlaceholder"),
			loading: t("whLoading"),
			name: t("whName"),
			namePlaceholder: t("whNamePlaceholder"),
			save: t("whSave"),
			saving: t("whSaving"),
			secret: t("whSecret"),
			secretHint: t("whSecretHint"),
			sectionChannels: t(SETTINGS_SECTION["webhook-channels"].titleKey),
			sendFailed: t("whSendFailed"),
			sending: t("whSending"),
			show: t("whShow"),
			sign: t("whSign"),
			switchFailed: t("whSwitchFailed"),
			test: t("whTest"),
			testSent: t("whTestSent"),
			testing: t("whTesting"),
			title: t("whTitle"),
			url: t("whUrl"),
			urlEditHint: t("whUrlEditHint"),
			urlRequired: t("whUrlRequired"),
		}),
		[t],
	);

	return {
		actions: {
			closeEditor: setEditorOpen,
			deleteEndpoint: handleDelete,
			openCreate,
			openEdit,
			submit: handleSubmit,
			testEndpoint: handleTest,
			toggleEndpoint: handleToggle,
			updateFormField,
		},
		editorError,
		editorOpen,
		editingId,
		endpoints,
		form,
		labels,
		loading,
		narrow,
		providerByKind,
		providers: localizedProviders,
		rowMessage,
		saving,
		testingId,
	};
}
