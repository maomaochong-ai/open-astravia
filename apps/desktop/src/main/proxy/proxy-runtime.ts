/**
 * 把桌面端的应用代理配置装到出网链路上。
 *
 * 三条通道，覆盖面依次收窄：
 * - **全局 dispatcher**：代理有效时换掉 undici 的全局 dispatcher，凡是走裸
 *   `fetch` 的出网点都跟着走代理——`@google/genai` 没有任何注入口，只能靠这条。
 * - **Provider 传输**：注入的 fetch 只用来做**例外**，把被用户排除的供应商显式
 *   拉回直连；代理配置无效时它还负责让请求带着原因失败。
 * - **代理环境变量**：本地命令、Go sidecar 与 Bedrock（走 node http，不吃 undici
 *   全局 dispatcher）只认 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`。
 *
 * 默认方向因此是反的：全局走代理、个别排除，而不是全局直连、个别加入。
 */

import {
	createDirectFetch,
	createProxyFetch,
	type GlobalProxyDispatcherHandle,
	installGlobalProxyDispatcher,
	type ManagedFetch,
	NO_PROXY_HOSTS,
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
	/** 测试注入点，避开真实 undici 与进程级全局状态。 */
	readonly installGlobalDispatcher?: (proxyUrl: string) => Promise<GlobalProxyDispatcherHandle>;
	readonly makeDirectFetch?: () => ManagedFetch;
}

export type ProxyRuntimeMode = "direct" | "proxy" | "invalid";

export interface ProxyRuntimeState {
	readonly mode: ProxyRuntimeMode;
	/** 仅 proxy：host:port，不含凭据。 */
	readonly target?: string;
}

interface ActiveProxyResources {
	readonly globalDispatcher?: GlobalProxyDispatcherHandle;
	readonly fetches: readonly ManagedFetch[];
}

let active: ActiveProxyResources | undefined;

async function releaseActive(): Promise<void> {
	const previous = active;
	active = undefined;
	if (!previous) return;
	// 旧连接池必须显式释放：改完地址还留着上一份，隧道会继续指向旧代理。
	await previous.globalDispatcher?.dispose().catch(() => {});
	for (const managed of previous.fetches) await managed.dispose().catch(() => {});
}

/**
 * 应用一份代理配置。启动时与每次配置变更后各调一次；重复调用安全。
 *
 * 返回本次生效的形态，供调用方记录日志或回给设置页。
 */
export async function applyDesktopProxy(
	config: DesktopProxyConfig | undefined,
	options: ProxyRuntimeOptions,
): Promise<ProxyRuntimeState> {
	const env = options.env ?? process.env;
	rememberInheritedProxyEnv(env);
	const resolution = resolveProxyConfig(config);

	await releaseActive();

	if (resolution.mode === "direct") {
		setProviderFetchResolver(undefined);
		restoreProxyEnv(env);
		log.info("application proxy disabled; provider requests go direct");
		return { mode: "direct" };
	}

	if (resolution.mode === "invalid") {
		// 全局 dispatcher 保持不动：一个拒绝一切的全局 dispatcher 会把更新检查、
		// 图片加载一并打死，代价远超收益。这里只让「本该走代理」的模型请求带着原因
		// 失败，配置无效本身由设置页那条提示负责告诉用户。
		const failing = createProxyFetch(config, {});
		if (failing) {
			active = { fetches: [failing] };
			setProviderFetchResolver((model) => (routingFor(model, options) === "proxy" ? failing.fetch : undefined));
		}
		restoreProxyEnv(env);
		log.warn(`application proxy configuration is invalid (${resolution.reason}); proxied requests will fail`);
		return { mode: "invalid" };
	}

	const globalDispatcher = await (options.installGlobalDispatcher ?? installGlobalProxyDispatcher)(resolution.url);
	// 只有被排除的供应商才需要注入：其余的由全局 dispatcher 兜住，包括那些拿不到
	// 注入 fetch 的厂商 SDK。
	const directFetch = (options.makeDirectFetch ?? createDirectFetch)();
	active = { globalDispatcher, fetches: [directFetch] };

	setProviderFetchResolver((model) => (routingFor(model, options) === "direct" ? directFetch.fetch : undefined));

	applyProxyEnv(env, resolution.url);
	// 只记 host:port，凭据绝不进日志。
	log.info(`application proxy enabled via ${resolution.target}`);
	return { mode: "proxy", target: resolution.target };
}

function routingFor(model: { provider: string; api: string; baseUrl?: string }, options: ProxyRuntimeOptions) {
	return decideProxyRouting({
		proxyActive: true,
		providerUseProxy: options.readProviderUseProxy(model.provider),
		api: model.api,
		baseUrl: model.baseUrl,
	});
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
