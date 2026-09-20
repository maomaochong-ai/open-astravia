import type { SshHostFormInput, SshHostProbe, SshHostSummary } from "@preload/api-types/ssh";
import { confirmDialogAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SshHostFormState {
	label: string;
	target: string;
	port: string;
	identityFile: string;
}

/** 某一行的探测结果。成功与失败都留在行内，不打断用户去看别处。 */
export interface SshHostRowMessage {
	tone: "success" | "error";
	text: string;
	/** 原始 stderr。默认折叠——它对定位问题有用，但不该当作首行文案。 */
	details?: string;
}

export interface SshHostsSettingsLabels {
	title: string;
	description: string;
	loading: string;
	section: string;
	add: string;
	addTitle: string;
	editTitle: string;
	save: string;
	cancel: string;
	empty: string;
	emptyHint: string;
	importFromConfig: string;
	importNone: string;
	importDone: string;
	fieldLabel: string;
	fieldLabelHint: string;
	fieldTarget: string;
	fieldTargetHint: string;
	fieldPort: string;
	fieldIdentityFile: string;
	fieldIdentityFileHint: string;
	test: string;
	testing: string;
	testDetails: string;
	edit: string;
	remove: string;
	removeTitle: string;
	removeConfirm: string;
	statusConnected: string;
	statusUnverifiable: string;
	statusUnknown: string;
}

export interface SshHostsSettingsModel {
	loading: boolean;
	hosts: readonly SshHostSummary[];
	/** 正在编辑的主机 id；`"new"` 表示新增表单展开中；null 表示表单关闭。 */
	editingId: string | "new" | null;
	form: SshHostFormState;
	saving: boolean;
	formError: string | null;
	/** 正在测试的主机 id。按行记录而不是全局布尔，多台主机可各自独立测试。 */
	testingId: string | null;
	rowMessage: Readonly<Record<string, SshHostRowMessage>>;
	importing: boolean;
	labels: SshHostsSettingsLabels;
	actions: {
		startAdd: () => void;
		startEdit: (host: SshHostSummary) => void;
		cancelEdit: () => void;
		setForm: (patch: Partial<SshHostFormState>) => void;
		submit: () => Promise<void>;
		test: (host: SshHostSummary) => Promise<void>;
		remove: (host: SshHostSummary) => void;
		importFromConfig: () => Promise<void>;
	};
}

const EMPTY_FORM: SshHostFormState = { label: "", target: "", port: "", identityFile: "" };

export function useSshHostsSettingsModel(): SshHostsSettingsModel {
	const { t } = useTranslation("settings");
	const setConfirm = useSetAtom(confirmDialogAtom);
	const [loading, setLoading] = useState(true);
	const [hosts, setHosts] = useState<readonly SshHostSummary[]>([]);
	const [editingId, setEditingId] = useState<string | "new" | null>(null);
	const [form, setFormState] = useState<SshHostFormState>(EMPTY_FORM);
	const [saving, setSaving] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [rowMessage, setRowMessage] = useState<Record<string, SshHostRowMessage>>({});
	const [importing, setImporting] = useState(false);

	const refresh = useCallback(async () => {
		setHosts(await window.vetta.ssh.listHosts());
	}, []);

	useEffect(() => {
		void refresh().finally(() => setLoading(false));
		// 主机状态由后台动作（工具调用、文件树刷新）改变，不经过本页面；没有这条订阅
		// 列表会一直停在打开设置页那一刻的状态上。
		const offHosts = window.vetta.ssh.onHostsChanged(() => void refresh());
		const offStatus = window.vetta.ssh.onHostStatusChanged(({ hostId, status }) => {
			setHosts((previous) => previous.map((host) => (host.id === hostId ? { ...host, status } : host)));
		});
		return () => {
			offHosts();
			offStatus();
		};
	}, [refresh]);

	const setForm = useCallback((patch: Partial<SshHostFormState>) => {
		setFormState((previous) => ({ ...previous, ...patch }));
		// 用户一开始改动就清掉上次的报错，避免旧错误跟着新输入继续显示。
		setFormError(null);
	}, []);

	const startAdd = useCallback(() => {
		setFormState(EMPTY_FORM);
		setFormError(null);
		setEditingId("new");
	}, []);

	const startEdit = useCallback((host: SshHostSummary) => {
		setFormState({
			label: host.label,
			target: host.target,
			port: host.port === undefined ? "" : String(host.port),
			identityFile: host.identityFile ?? "",
		});
		setFormError(null);
		setEditingId(host.id);
	}, []);

	const cancelEdit = useCallback(() => {
		setEditingId(null);
		setFormError(null);
	}, []);

	const submit = useCallback(async () => {
		if (editingId === null) return;
		const port = form.port.trim();
		const input: SshHostFormInput = {
			label: form.label.trim() || form.target.trim(),
			target: form.target.trim(),
			...(port ? { port: Number(port) } : {}),
			...(form.identityFile.trim() ? { identityFile: form.identityFile.trim() } : {}),
		};
		setSaving(true);
		setFormError(null);
		try {
			if (editingId === "new") await window.vetta.ssh.createHost(input);
			else await window.vetta.ssh.updateHost({ ...input, id: editingId });
			setEditingId(null);
			await refresh();
		} catch (error) {
			// 表单保持打开且保留已输入内容：让用户在原地改，而不是重填一遍。
			setFormError(toMessage(error));
		} finally {
			setSaving(false);
		}
	}, [editingId, form, refresh]);

	const test = useCallback(
		async (host: SshHostSummary) => {
			setTestingId(host.id);
			setRowMessage((previous) => {
				const { [host.id]: _removed, ...rest } = previous;
				return rest;
			});
			try {
				const outcome = classifyProbe(await window.vetta.ssh.testHost(host.id));
				setRowMessage((previous) => ({
					...previous,
					[host.id]:
						outcome.kind === "failed"
							? { tone: "error", text: t("sshTestFailed"), details: outcome.details }
							: {
									tone: "success",
									text:
										outcome.kind === "ok"
											? t("sshTestOk", { platform: outcome.platform })
											: t("sshTestOkMissing", { platform: outcome.platform, tools: outcome.tools }),
								},
				}));
			} catch (error) {
				setRowMessage((previous) => ({
					...previous,
					[host.id]: { tone: "error", text: t("sshTestFailed"), details: toMessage(error) },
				}));
			} finally {
				setTestingId(null);
			}
		},
		[t],
	);

	const remove = useCallback(
		(host: SshHostSummary) => {
			setConfirm({
				title: t("sshRemoveTitle"),
				message: t("sshRemoveConfirm", { name: host.label }),
				confirmLabel: t("sshRemove"),
				variant: "danger",
				onConfirm: () => {
					void window.vetta.ssh
						.removeHost(host.id)
						.then(() => refresh())
						.catch((error: unknown) => {
							// 主机仍被项目引用是最常见的失败，原因要让用户看见而不是静默失败。
							setRowMessage((previous) => ({
								...previous,
								[host.id]: { tone: "error", text: toMessage(error) },
							}));
						});
				},
			});
		},
		[refresh, setConfirm, t],
	);

	const importFromConfig = useCallback(async () => {
		setImporting(true);
		try {
			const aliases = await window.vetta.ssh.listConfigAliases();
			const added = await window.vetta.ssh.importFromConfig(aliases);
			await refresh();
			setConfirm({
				title: t("sshImportFromConfig"),
				message: added.length === 0 ? t("sshImportNone") : t("sshImportDone", { count: added.length }),
				variant: "default",
				onConfirm: () => {},
			});
		} finally {
			setImporting(false);
		}
	}, [refresh, setConfirm, t]);

	const labels = useMemo<SshHostsSettingsLabels>(
		() => ({
			title: t("tabSshHosts"),
			description: t("sshHostsDescription"),
			loading: t("loading"),
			section: t("section_ssh-hosts-list"),
			add: t("sshAddHost"),
			addTitle: t("sshAddHost"),
			editTitle: t("sshEditHost"),
			save: t("sshSaveHost"),
			cancel: t("cancel"),
			empty: t("sshHostsEmpty"),
			emptyHint: t("sshHostsEmptyHint"),
			importFromConfig: t("sshImportFromConfig"),
			importNone: t("sshImportNone"),
			importDone: t("sshImportDone", { count: 0 }),
			fieldLabel: t("sshFieldLabel"),
			fieldLabelHint: t("sshFieldLabelHint"),
			fieldTarget: t("sshFieldTarget"),
			fieldTargetHint: t("sshFieldTargetHint"),
			fieldPort: t("sshFieldPort"),
			fieldIdentityFile: t("sshFieldIdentityFile"),
			fieldIdentityFileHint: t("sshFieldIdentityFileHint"),
			test: t("sshTest"),
			testing: t("sshTesting"),
			testDetails: t("sshTestDetails"),
			edit: t("sshEditHost"),
			remove: t("sshRemove"),
			removeTitle: t("sshRemoveTitle"),
			removeConfirm: t("sshRemoveConfirm", { name: "" }),
			statusConnected: t("sshStatusConnected"),
			statusUnverifiable: t("sshStatusUnverifiable"),
			statusUnknown: t("sshStatusUnknown"),
		}),
		[t],
	);

	return {
		loading,
		hosts,
		editingId,
		form,
		saving,
		formError,
		testingId,
		rowMessage,
		importing,
		labels,
		actions: { startAdd, startEdit, cancelEdit, setForm, submit, test, remove, importFromConfig },
	};
}

/**
 * 探测结果分三种情况，供调用方挑文案。
 *
 * 判定与文案分开：i18n 的 key 是字面量类型，把 `t` 当参数透传过不了类型检查；拆开
 * 之后这段判断也能独立测试。
 *
 * 「连上了但缺工具」必须与「连上了」区分开：远端没有 git 时用户照样能建项目、能读写
 * 文件，只是 Agent 跑 git 会失败——报成连接失败会让他去查一台其实好好的机器。
 */
export type SshProbeOutcome =
	| { kind: "failed"; details: string }
	| { kind: "ok"; platform: string }
	| { kind: "ok-missing-tools"; platform: string; tools: string };

export function classifyProbe(probe: SshHostProbe): SshProbeOutcome {
	if (!probe.ok) return { kind: "failed", details: probe.error };
	const platform = [probe.os, probe.arch].filter(Boolean).join(" ");
	const missing = [probe.hasGit ? "" : "git", probe.hasRipgrep ? "" : "rg"].filter((tool) => tool.length > 0);
	if (missing.length === 0) return { kind: "ok", platform };
	return { kind: "ok-missing-tools", platform, tools: missing.join("、") };
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
