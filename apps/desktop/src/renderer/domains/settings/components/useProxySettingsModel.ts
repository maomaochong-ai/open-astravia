import type { DesktopProxyConfigPatchData, DesktopProxyProtocol } from "@preload/api-types/config";
import { supportsProviderFetchInjection } from "@vetta/ai/protocol";
import type { ProxyProviderRowView } from "@vetta-org/theme-ui/settings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** 文本字段逐字保存会让每个按键都触发一次落盘与代理重建。 */
const TEXT_COMMIT_DELAY_MS = 400;

/** 列表数据本身，不含任何文案；展示用的行由 `t` 在渲染期拼出来。 */
interface LoadedProxyProvider {
	readonly id: string;
	readonly displayName: string;
	readonly useProxy: boolean;
	readonly supported: boolean;
}

export interface ProxySettingsDraft {
	enabled: boolean;
	protocol: DesktopProxyProtocol;
	host: string;
	port: string;
	username: string;
	password: string;
}

export interface ProxySettingsModel {
	readonly draft: ProxySettingsDraft;
	readonly passwordStored: boolean;
	/** 已启用但地址/端口填不全或非法——此时请求会失败，必须显式提示。 */
	readonly invalid: boolean;
	readonly providers: readonly ProxyProviderRowView[];
	readonly protocolOptions: readonly { value: string; label: string }[];
	readonly labels: ProxySettingsLabels;
	readonly actions: {
		setEnabled: (enabled: boolean) => void;
		setProtocol: (protocol: string) => void;
		setHost: (host: string) => void;
		setPort: (port: string) => void;
		setUsername: (username: string) => void;
		setPassword: (password: string) => void;
		setProviderUseProxy: (providerId: string, useProxy: boolean) => void;
	};
}

export interface ProxySettingsLabels {
	sectionTitle: string;
	enableTitle: string;
	enableDescription: string;
	protocolTitle: string;
	hostTitle: string;
	hostPlaceholder: string;
	portTitle: string;
	usernameTitle: string;
	usernamePlaceholder: string;
	passwordTitle: string;
	passwordPlaceholder: string;
	passwordStoredPlaceholder: string;
	providersTitle: string;
	providersDescription: string;
	noProviders: string;
	invalidConfig: string;
}

const EMPTY_DRAFT: ProxySettingsDraft = {
	enabled: false,
	protocol: "http",
	host: "",
	port: "7890",
	username: "",
	password: "",
};

/** 与主进程 `resolveProxyConfig` 同一判据的最小镜像，只用于即时提示。 */
export function isProxyDraftInvalid(draft: ProxySettingsDraft): boolean {
	if (!draft.enabled) return false;
	const host = draft.host.trim();
	if (host === "" || /[\s/\\@#?%]/.test(host)) return true;
	const port = Number.parseInt(draft.port, 10);
	return !Number.isInteger(port) || port < 1 || port > 65535;
}

export function useProxySettingsModel(): ProxySettingsModel {
	const { t } = useTranslation("settings");
	const [draft, setDraft] = useState<ProxySettingsDraft>(EMPTY_DRAFT);
	const [passwordStored, setPasswordStored] = useState(false);
	const [providers, setProviders] = useState<readonly LoadedProxyProvider[]>([]);
	const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			const proxy = config.proxy;
			if (!proxy) return;
			setPasswordStored(proxy.passwordConfigured);
			setDraft({
				enabled: proxy.enabled,
				protocol: proxy.protocol,
				host: proxy.host,
				port: String(proxy.port),
				username: proxy.username,
				password: "",
			});
		});
	}, []);

	// 这个 effect 只加载数据，刻意不依赖 `t`：i18n 的 `t` 每次渲染都可能是新引用，
	// 带上它会让列表在每次渲染后被重新拉取，用户刚拨的开关立刻被覆盖回去。
	useEffect(() => {
		void window.vetta.models.get().then((config) => {
			setProviders(
				Object.entries(config.providers ?? {}).map(([id, provider]) => ({
					id,
					displayName: provider.displayName ?? id,
					// 缺省跟随全局：开启代理后默认走代理，显式 false 才排除。
					useProxy: provider.useProxy !== false,
					supported: supportsProviderFetchInjection(
						provider.api ?? provider.models?.[0]?.api ?? "openai-completions",
					),
				})),
			);
		});
	}, []);

	useEffect(() => {
		return () => {
			if (commitTimer.current) clearTimeout(commitTimer.current);
		};
	}, []);

	const commit = useCallback((patch: DesktopProxyConfigPatchData) => {
		void window.vetta.config.set({ proxy: patch });
	}, []);

	/** 文本字段：先更新草稿保证输入跟手，落盘推迟到停止输入之后。 */
	const commitDebounced = useCallback(
		(patch: DesktopProxyConfigPatchData) => {
			if (commitTimer.current) clearTimeout(commitTimer.current);
			commitTimer.current = setTimeout(() => commit(patch), TEXT_COMMIT_DELAY_MS);
		},
		[commit],
	);

	const updateText = useCallback(
		(field: "host" | "port" | "username" | "password", value: string) => {
			setDraft((current) => {
				const next = { ...current, [field]: value };
				commitDebounced(
					field === "port"
						? { port: Number.parseInt(value, 10) || 0 }
						: ({ [field]: value } as DesktopProxyConfigPatchData),
				);
				return next;
			});
			if (field === "password") setPasswordStored(value.length > 0);
		},
		[commitDebounced],
	);

	const actions = useMemo(
		() => ({
			setEnabled: (enabled: boolean) => {
				setDraft((current) => ({ ...current, enabled }));
				commit({ enabled });
			},
			setProtocol: (protocol: string) => {
				const next = protocol === "https" ? "https" : "http";
				setDraft((current) => ({ ...current, protocol: next }));
				commit({ protocol: next });
			},
			setHost: (host: string) => updateText("host", host),
			setPort: (port: string) => updateText("port", port),
			setUsername: (username: string) => updateText("username", username),
			setPassword: (password: string) => updateText("password", password),
			setProviderUseProxy: (providerId: string, useProxy: boolean) => {
				setProviders((current) =>
					current.map((provider) => (provider.id === providerId ? { ...provider, useProxy } : provider)),
				);
				void (async () => {
					const config = await window.vetta.models.get();
					const provider = config.providers?.[providerId];
					if (!provider) return;
					await window.vetta.models.set({
						...config,
						providers: { ...config.providers, [providerId]: { ...provider, useProxy } },
					});
				})();
			},
		}),
		[commit, updateText],
	);

	const labels = useMemo<ProxySettingsLabels>(
		() => ({
			sectionTitle: t("proxy.sectionTitle"),
			enableTitle: t("proxy.enableTitle"),
			enableDescription: t("proxy.enableDescription"),
			protocolTitle: t("proxy.protocolTitle"),
			hostTitle: t("proxy.hostTitle"),
			hostPlaceholder: t("proxy.hostPlaceholder"),
			portTitle: t("proxy.portTitle"),
			usernameTitle: t("proxy.usernameTitle"),
			usernamePlaceholder: t("proxy.usernamePlaceholder"),
			passwordTitle: t("proxy.passwordTitle"),
			passwordPlaceholder: t("proxy.passwordPlaceholder"),
			passwordStoredPlaceholder: t("proxy.passwordStoredPlaceholder"),
			providersTitle: t("proxy.providersTitle"),
			providersDescription: t("proxy.providersDescription"),
			noProviders: t("proxy.noProviders"),
			invalidConfig: t("proxy.invalidConfig"),
		}),
		[t],
	);

	const providerRows = useMemo<readonly ProxyProviderRowView[]>(
		() =>
			providers.map((provider) => ({
				id: provider.id,
				displayName: provider.displayName,
				useProxy: provider.useProxy,
				...(provider.supported ? {} : { lockedReason: t("proxy.providerFollowsGlobal") }),
			})),
		[providers, t],
	);

	return {
		draft,
		passwordStored,
		invalid: isProxyDraftInvalid(draft),
		providers: providerRows,
		protocolOptions: useMemo(
			() => [
				{ value: "http", label: "HTTP" },
				{ value: "https", label: "HTTPS" },
			],
			[],
		),
		labels,
		actions,
	};
}
