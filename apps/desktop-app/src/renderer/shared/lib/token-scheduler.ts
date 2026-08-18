import { tryRefreshAccessToken } from "./api";

/**
 * 主动 refresh 调度：
 * 解析 access JWT 的 `exp`，在到期前 LEAD_TIME 触发一次主进程权威 refresh。
 * 正常使用下 access 几乎永远不会过期到 401，跨进程 race 的触发窗口也归零。
 *
 * 注意：refresh 的写盘 / 广播由主进程负责；本模块只触发，不直接操作 token。
 */

const LEAD_TIME_MS = 5 * 60 * 1000; // 到期前 5 分钟刷新
const MIN_DELAY_MS = 1000; // 最少 1s 后跑，避免连环重排导致同步爆栈
const MAX_DELAY_MS = 2 ** 31 - 1; // setTimeout 上限

function decodeJwtExpMs(token: string): number | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		// JWT payload 是 base64url
		const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
		const json = JSON.parse(atob(padded)) as { exp?: number };
		if (typeof json.exp !== "number") return null;
		return json.exp * 1000;
	} catch {
		return null;
	}
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleProactiveRefresh(accessToken: string): void {
	cancelProactiveRefresh();
	const expMs = decodeJwtExpMs(accessToken);
	if (!expMs) return;
	const delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, expMs - Date.now() - LEAD_TIME_MS));
	timer = setTimeout(() => {
		timer = null;
		// 主进程 refresh 成功会广播新 token，触发 useAuth 的 onTokenRefreshed
		// 监听器再次调用本方法，自动接力下一轮。
		void tryRefreshAccessToken();
	}, delay);
}

export function cancelProactiveRefresh(): void {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}
