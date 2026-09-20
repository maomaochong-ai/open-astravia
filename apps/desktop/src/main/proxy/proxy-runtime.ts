/**
 * 把桌面端的应用代理配置装到出网链路上。
 *
 * 两条通道，覆盖面不同，缺一不可：
 * - **Provider 传输**：`@vetta/ai` 的解析器，逐个供应商决定走代理还是直连。
 * - **代理环境变量**：本地命令、sidecar，以及 Bedrock / Google 这类自带 SDK、
 *   拿不到注入 fetch 的 Provider，只认 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`。
 *   它是进程级的，给不了按供应商的粒度，所以只当兜底。
 */

import {
	createProxyFetch,
	NO_PROXY_HOSTS,
	type ProxyFetch,
	resolveProxyConfig,
	setProviderFetchResolver,
} from "@vetta/ai";
import { getAppLogger } from "../logger.js";
import { decideProxyRouting } from "./proxy-routing.js";
import type { DesktopProxyConfig } from "./proxy-settings.js";

const log = getAppLogger("proxy");

const PROXY_ENV_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"] as const;

/**
 * 进程启动时继承来的代理环境变量。关掉应用代理要还原成它，而不是一删了事——
 * 用户可能本来就在 shell 里导出了 `HTTPS_PROXY`，删掉等于把他原有的代理弄没了。
 */
const inheritedProxyEnv = new WeakMap<NodeJS.ProcessEnv, Partial<Record<(typeof PROXY_ENV_KEYS)[number], string>>>();

function rememberInheritedProxyEnv(env: NodeJS.ProcessEnv): void {
	if (inheritedProxyEnv.has(env)) return;
	const baseline: Partial<Record<(typeof PROXY_ENV_KEYS)[number], string>> = {};
	for (const key of PROXY_ENV_KEYS) {
		const value = env[key];
		if (value !== undefined) baseline[key] = value;
	}
	inheritedProxyEnv.set(env, baseline);
}

export interface ProxyRuntimeOptions {
	/** 读取各供应商的代理开关。默认接 models.json。 */
	readonly readProviderUseProxy: (providerId: string) => boolean | undefined;
	readonly env?: NodeJS.ProcessEnv;
}

let activeProxyFetch: ProxyFetch | undefined;

/**
 * 应用一份代理配置。启动时与每次配置变更后各调一次；重复调用安全。
 *
 * 返回本次生效的形态，供调用方记录日志或回给设置页。
 */
export function applyDesktopProxy(
	config: DesktopProxyConfig | undefined,
	options: ProxyRuntimeOptions,
): { mode: "direct" | "proxy" | "invalid"; target?: string } {
	const env = options.env ?? process.env;
	rememberInheritedProxyEnv(env);
	const resolution = resolveProxyConfig(config);

	// 旧连接池必须显式释放：改完地址还留着上一份，隧道会继续指向旧代理。
	const previous = activeProxyFetch;
	activeProxyFetch = undefined;
	if (previous) void previous.dispose().catch(() => {});

	if (resolution.mode === "direct") {
		setProviderFetchResolver(undefined);
		restoreProxyEnv(env);
		log.info("application proxy disabled; provider requests go direct");
		return { mode: "direct" };
	}

	const proxyFetch = createProxyFetch(config, {});
	if (!proxyFetch) {
		setProviderFetchResolver(undefined);
		restoreProxyEnv(env);
		return { mode: "direct" };
	}
	activeProxyFetch = proxyFetch;

	setProviderFetchResolver((model) => {
		const decision = decideProxyRouting({
			proxyActive: true,
			providerUseProxy: options.readProviderUseProxy(model.provider),
			api: model.api,
		});
		return decision === "proxy" ? proxyFetch.fetch : undefined;
	});

	if (resolution.mode === "invalid") {
		// 不写代理环境变量，也不撤回解析器：每个请求都会带着具体原因失败，
		// 而不是安静地直连出去。
		restoreProxyEnv(env);
		log.warn(`application proxy configuration is invalid (${resolution.reason}); provider requests will fail`);
		return { mode: "invalid" };
	}

	applyProxyEnv(env, resolution.url);
	// 只记 host:port，凭据绝不进日志。
	log.info(`application proxy enabled via ${resolution.target}`);
	return { mode: "proxy", target: resolution.target };
}

function applyProxyEnv(env: NodeJS.ProcessEnv, proxyUrl: string): void {
	env.HTTP_PROXY = proxyUrl;
	env.http_proxy = proxyUrl;
	env.HTTPS_PROXY = proxyUrl;
	env.https_proxy = proxyUrl;
	env.NO_PROXY = NO_PROXY_HOSTS;
	env.no_proxy = NO_PROXY_HOSTS;
}

function restoreProxyEnv(env: NodeJS.ProcessEnv): void {
	const baseline = inheritedProxyEnv.get(env) ?? {};
	for (const key of PROXY_ENV_KEYS) {
		const value = baseline[key];
		if (value === undefined) delete env[key];
		else env[key] = value;
	}
}
