import type { SubscriptionStatus } from "@preload/api.js";
import { atom } from "jotai";

export interface AuthUser {
	id: number;
	username: string;
	nickname: string;
	phone?: string;
	email?: string;
	avatar: string;
}

export const authTokenAtom = atom<string | null>(localStorage.getItem("vetta-auth-token"));
export const authUserAtom = atom<AuthUser | null>(null);
export const loginPopoverOpenAtom = atom<boolean>(false);

// ─── Remote providers (from server) ───

export const remoteProvidersAtom = atom<Record<string, unknown>>({});

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
