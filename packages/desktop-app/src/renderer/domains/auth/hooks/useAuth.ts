import { fetchCurrentUser, logoutOnServer, onTokenRefreshed, onUnauthorized } from "@shared/lib/api";
import { cancelProactiveRefresh, scheduleProactiveRefresh } from "@shared/lib/token-scheduler";
import {
	authTokenAtom,
	authUserAtom,
	loginPopoverOpenAtom,
	remoteProvidersAtom,
	sseClientAtom,
	sseConnectionStateAtom,
} from "@shared/store/atoms";
import { subscriptionStatusAtom } from "@shared/store/auth-atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { setProductAnalyticsUser } from "../../../telemetry/product-analytics";

const ACCESS_TOKEN_KEY = "vetta-auth-token";
const REFRESH_TOKEN_KEY = "vetta-refresh-token";

export function useAuth() {
	const [token, setToken] = useAtom(authTokenAtom);
	const [user, setUser] = useAtom(authUserAtom);
	const setLoginOpen = useSetAtom(loginPopoverOpenAtom);
	const setRemoteProviders = useSetAtom(remoteProvidersAtom);
	const setSubscriptionStatus = useSetAtom(subscriptionStatusAtom);
	const sseClient = useAtomValue(sseClientAtom);
	const setSseState = useSetAtom(sseConnectionStateAtom);

	useEffect(() => {
		setProductAnalyticsUser(user?.id ?? null);
	}, [user]);

	const logout = useCallback(() => {
		// 注意：这里只清服务器侧状态（token / user / 远程 providers / SSE）。
		// 不要中断正在运行的会话，也不要清 selectedModel——
		// 用户可能正用本地模型离线工作，token 掉了完全不影响他们。
		const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY) ?? undefined;
		void logoutOnServer(storedRefresh);
		setToken(null);
		setUser(null);
		localStorage.removeItem(ACCESS_TOKEN_KEY);
		localStorage.removeItem(REFRESH_TOKEN_KEY);
		void window.vetta.settings.setServerToken(undefined);
		void window.vetta.settings.setServerRefreshToken(undefined);
		setRemoteProviders({});
		sseClient.disconnect();
	}, [setToken, setUser, setRemoteProviders, sseClient]);

	// On mount: if we have a token, fetch user info
	useEffect(() => {
		if (token && !user) {
			void fetchCurrentUser(token)
				.then((u) => setUser(u))
				.catch((err) => {
					// 不要在这里登出：明确的 401（token 失效/撤销）已由 request() 内部
					// notifyUnauthorized → onUnauthorized 监听器统一处理登出。
					// 这里只会收到暂时性错误（网络/超时/5xx），登出反而会因为快速刷新误踢用户。
					console.warn("[useAuth] fetchCurrentUser on mount failed (transient, keep session):", err);
				});
		}
	}, [token, user, setUser]);

	// Listen for 401 responses (refresh 已失败) - auto logout
	useEffect(() => {
		return onUnauthorized(() => {
			logout();
		});
	}, [logout]);

	// 主进程在 refresh 失败时广播 unauthorized
	useEffect(() => {
		return window.vetta.auth.onUnauthorized(() => {
			logout();
		});
	}, [logout]);

	// refresh 成功后，把新 token 同步到 atom，保证 React 树立刻拿到新值
	useEffect(() => {
		return onTokenRefreshed(({ accessToken }) => {
			setToken(accessToken);
		});
	}, [setToken]);

	// 主动刷新：每次 token 变化（含初次挂载、登录、refresh 成功）都重排到下次到期前
	useEffect(() => {
		if (!token) {
			cancelProactiveRefresh();
			return;
		}
		scheduleProactiveRefresh(token);
		return () => cancelProactiveRefresh();
	}, [token]);

	// Listen for OAuth callback from main process
	useEffect(() => {
		const cleanup = window.vetta.auth.onOAuthCallback((data) => {
			setToken(data.token);
			localStorage.setItem(ACCESS_TOKEN_KEY, data.token);
			if (data.refreshToken) {
				localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
				void window.vetta.settings.setServerRefreshToken(data.refreshToken);
			}
			setLoginOpen(false);
			void window.vetta.settings.setServerToken(data.token);
			void fetchCurrentUser(data.token)
				.then((u) => setUser(u))
				.catch(console.error);
			// 远程模型拉取由下面的 token effect 统一负责
		});
		return cleanup;
	}, [setToken, setUser, setLoginOpen]);

	// 登录态变化时刷新远程模型列表与套餐状态；登出时清空。
	useEffect(() => {
		if (!token) {
			setRemoteProviders({});
			// 登出：重置内存态为 null，读 atom 时回退到 localStorage 缓存(保留上次已知)。
			setSubscriptionStatus(null);
			return;
		}
		void window.vetta.models
			.fetchRemote()
			.then((result) => {
				// 无条件赋值：401 时主进程返回 {}，必须覆盖旧的远程 providers，
				// 否则 ModelSelector 仍会展示已失效的线上模型。
				setRemoteProviders((result.providers ?? {}) as Record<string, unknown>);
			})
			.catch(console.error);
		void window.vetta.subscription
			.getStatus()
			.then((result) => {
				// 拉取成功才覆盖；失败(status:null)保持内存态不变，UI 用 localStorage 缓存回退。
				if (result.status) setSubscriptionStatus(result.status);
			})
			.catch(console.error);
	}, [token, setRemoteProviders, setSubscriptionStatus]);

	// SSE: connect when token is available, disconnect on logout
	useEffect(() => {
		if (!token) return;
		void window.vetta.settings.getServerUrl().then((baseUrl) => {
			sseClient.connect(baseUrl, token);
		});
		const unsubState = sseClient.onStateChange(setSseState);
		return () => {
			unsubState();
		};
	}, [token, sseClient, setSseState]);

	return { token, user, logout };
}
