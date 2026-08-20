import type { SubscriptionStatus } from "@preload/api.js";
import { logoutOnServer } from "@shared/lib/api";
import { atom } from "jotai";
import { remoteProvidersAtom } from "./model-catalog-atoms";
import { sseClientAtom } from "./sse-atoms";

export interface AuthUser {
	id: number;
	username: string;
	nickname: string;
	phone?: string;
	email?: string;
	avatar: string;
}

// 迁移旧版本遗留的明文凭据；登录 token 此后只保存在 renderer 内存与主进程凭据存储中。
localStorage.removeItem("vetta-auth-token");
localStorage.removeItem("vetta-refresh-token");

export const authTokenAtom = atom<string | null>(null);
export const authUserAtom = atom<AuthUser | null>(null);
export const loginPopoverOpenAtom = atom<boolean>(false);

/**
 * 登出：只清服务器侧状态（token / user / 远程 providers / SSE）。
 * 不中断正在运行的会话，也不清 selectedModel——用户可能正用本地模型
 * 离线工作，token 掉了完全不影响他们。套餐状态的重置由 cloud 模块的
 * token effect 统一处理（token 变 null 时触发）。
 *
 * 放在 shared store 而不是 cloud 模块里，是为了让宿主 UI（设置菜单）能在
 * 不 import cloud 代码的前提下触发登出；lite 构建下 user 恒为 null，
 * 登出入口不渲染，本 atom 不可达。
 */
export const cloudLogoutAtom = atom(null, (get, set) => {
	void window.vetta.settings
		.getServerRefreshToken()
		.then((storedRefresh) => logoutOnServer(storedRefresh))
		// 服务端登出失败（网络等）不阻塞本地登出，只留痕
		.catch((err) => console.warn("[cloudLogout] logoutOnServer failed:", err))
		.finally(() => window.vetta.settings.setServerRefreshToken(undefined));
	set(authTokenAtom, null);
	set(authUserAtom, null);
	void window.vetta.settings.setServerToken(undefined);
	set(remoteProvidersAtom, {});
	get(sseClientAtom).disconnect();
});

// ─── Remote providers (from server) ───
// 定义在 model-catalog-atoms（叶子模块），这里转出以保持既有引用路径。

export { remoteProvidersAtom } from "./model-catalog-atoms";

// ─── Subscription status (Vetta Go 套餐，ADR-0016 离线回退) ───

const SUBSCRIPTION_CACHE_KEY = "vetta-subscription-flags";

interface CachedSubscriptionFlags {
	go_enabled: boolean;
}

/**
 * 读取上次已知的 go 启用标志。
 * 首次运行(无缓存)默认关，隐藏全部特殊待遇。
 */
function readCachedFlags(): CachedSubscriptionFlags {
	try {
		const raw = localStorage.getItem(SUBSCRIPTION_CACHE_KEY);
		if (!raw) return { go_enabled: false };
		const parsed = JSON.parse(raw) as Partial<CachedSubscriptionFlags>;
		return {
			go_enabled: parsed.go_enabled === true,
		};
	} catch {
		return { go_enabled: false };
	}
}

function persistFlags(flags: CachedSubscriptionFlags): void {
	try {
		localStorage.setItem(SUBSCRIPTION_CACHE_KEY, JSON.stringify(flags));
	} catch {
		// localStorage 不可用时忽略——内存中的 atom 仍然生效。
	}
}

// 内部基础 atom：初始为 null（未拉取过）。fetch 成功后 set 进来。
const subscriptionStatusBaseAtom = atom<SubscriptionStatus | null>(null);

/**
 * 套餐状态读写 atom。
 * - 读：返回当前内存状态；若尚未拉取(null)，回退到 localStorage 缓存的 go 标志构造的最小状态。
 * - 写：set SubscriptionStatus 时持久化 go 标志；set null 不动缓存(离线/失败时仍用上次已知)。
 */
export const subscriptionStatusAtom = atom<SubscriptionStatus, [SubscriptionStatus | null], void>(
	(get): SubscriptionStatus => {
		const current = get(subscriptionStatusBaseAtom);
		if (current) return current;
		const cached = readCachedFlags();
		return {
			active: false,
			go_enabled: cached.go_enabled,
		};
	},
	(_get, set, next) => {
		set(subscriptionStatusBaseAtom, next);
		if (next) {
			persistFlags({ go_enabled: next.go_enabled });
		}
	},
);
