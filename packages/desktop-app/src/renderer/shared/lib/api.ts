import type { RefreshOutcome } from "@preload/api";
import { i18n } from "@shared/i18n";

let cachedBaseUrl: string | undefined;

async function getApiBase(): Promise<string> {
	if (cachedBaseUrl) return cachedBaseUrl;
	cachedBaseUrl = await window.vetta.settings.getServerUrl();
	return cachedBaseUrl;
}

/** Listeners notified when server responds with 401 and refresh fails. */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
	unauthorizedListeners.add(listener);
	return () => unauthorizedListeners.delete(listener);
}

function notifyUnauthorized(): void {
	for (const listener of unauthorizedListeners) {
		listener();
	}
}

/**
 * Listeners notified after a successful refresh — gives renderer atoms /
 * localStorage / settings.json a single sync point.
 */
type TokenRefreshedListener = (next: { accessToken: string; refreshToken: string }) => void;
const tokenRefreshedListeners = new Set<TokenRefreshedListener>();

export function onTokenRefreshed(listener: TokenRefreshedListener): () => void {
	tokenRefreshedListeners.add(listener);
	return () => tokenRefreshedListeners.delete(listener);
}

function notifyTokenRefreshed(next: { accessToken: string; refreshToken: string }): void {
	for (const listener of tokenRefreshedListeners) {
		listener(next);
	}
}

interface ApiResponse<T> {
	code: number;
	message: string;
	data?: T;
}

const ACCESS_TOKEN_KEY = "vetta-auth-token";
const REFRESH_TOKEN_KEY = "vetta-refresh-token";

function readStoredAccessToken(): string | undefined {
	return localStorage.getItem(ACCESS_TOKEN_KEY) ?? undefined;
}

/**
 * 单飞：并发 401 只触发一次 refresh。
 * 实现：委托主进程做唯一权威 refresh，避免主/渲染两端同时拿同一个
 * refresh_token 调 /auth/refresh 触发服务端 reuse-detection 的 revoked 错误。
 * 主进程成功后会写 settings.json + 广播 `vetta:auth:token-refreshed`，
 * 渲染层的 localStorage / atom 由顶部的广播订阅 + notifyTokenRefreshed 同步。
 */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

export async function tryRefreshAccessToken(): Promise<RefreshOutcome> {
	if (refreshInFlight) return refreshInFlight;
	refreshInFlight = (async (): Promise<RefreshOutcome> => {
		try {
			return await window.vetta.auth.refreshToken();
		} catch {
			// IPC 异常按暂时性处理，不登出。
			return { status: "transient" };
		}
	})();
	try {
		return await refreshInFlight;
	} finally {
		refreshInFlight = null;
	}
}

/**
 * 主进程广播的 refresh 结果：把新 token 也写到 localStorage，并通知 atom 订阅者。
 * 主进程已经写过 settings.json，所以这里不再回写主进程，避免回环。
 */
window.vetta?.auth?.onTokenRefreshed?.((next) => {
	localStorage.setItem(ACCESS_TOKEN_KEY, next.accessToken);
	localStorage.setItem(REFRESH_TOKEN_KEY, next.refreshToken);
	notifyTokenRefreshed(next);
});

/**
 * 若 options.headers 含 Authorization，则用新 token 替换；否则保持原样。
 */
function withNewAuth(options: RequestInit | undefined, accessToken: string): RequestInit | undefined {
	if (!options?.headers) return options;
	const headers = new Headers(options.headers as HeadersInit);
	if (headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${accessToken}`);
		return { ...options, headers };
	}
	return options;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const base = await getApiBase();
	let res = await fetch(base + path, options);
	if (res.status === 401) {
		// 不要给 /auth/refresh 自身做 refresh-retry，避免死循环
		if (path === "/auth/refresh") {
			notifyUnauthorized();
			throw new Error("登录已过期，请重新登录");
		}
		const outcome = await tryRefreshAccessToken();
		if (outcome.status === "transient") {
			// 暂时性失败（网络/超时/5xx）：不登出，抛普通错误让上层重试/提示。
			throw new Error("网络异常，请稍后重试");
		}
		if (outcome.status === "unauthorized") {
			notifyUnauthorized();
			throw new Error("登录已过期，请重新登录");
		}
		res = await fetch(base + path, withNewAuth(options, outcome.accessToken));
		if (res.status === 401) {
			notifyUnauthorized();
			throw new Error("登录已过期，请重新登录");
		}
	}
	const json = (await res.json()) as ApiResponse<T>;
	if (json.code !== 0) {
		throw new Error(json.message);
	}
	return json.data as T;
}

/**
 * 读取当前最新的 access token（refresh 后会自动更新）。
 * 提供给 SSE / 直接拼 URL（如 flowingDownloadUrl）的场景使用——
 * 这些路径不走 request()，所以无法自动 refresh，至少要能拿到最新值。
 */
export function getCurrentAccessToken(): string | undefined {
	return readStoredAccessToken();
}

function authHeaders(token: string): HeadersInit {
	return { Authorization: `Bearer ${token}` };
}

// ─── Server Info ───

export type DeployMode = "enterprise" | "personal";

export async function fetchServerInfo(): Promise<{ deploy_mode: DeployMode }> {
	return request<{ deploy_mode: DeployMode }>("/info");
}

// ─── Team (personal mode) ───

export interface TeamVO {
	id: number;
	name: string;
	owner_id: number;
	role?: string;
	created_at: string;
}

export interface TeamDetailVO {
	id: number;
	name: string;
	owner_id: number;
	invite_code: string;
	members: TeamMemberVO[];
	created_at: string;
}

export interface TeamMemberVO {
	id: number;
	user_id: number;
	username: string;
	avatar: string;
	role: string;
	created_at: string;
}

export async function fetchMyTeams(token: string): Promise<TeamVO[]> {
	return request<TeamVO[]>("/teams", {
		headers: authHeaders(token),
	});
}

export async function createTeam(token: string, name: string): Promise<TeamVO> {
	return request<TeamVO>("/teams", {
		method: "POST",
		headers: { ...authHeaders(token), "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
}

export async function fetchTeamDetail(token: string, teamId: number): Promise<TeamDetailVO> {
	return request<TeamDetailVO>(`/teams/${teamId}`, {
		headers: authHeaders(token),
	});
}

export async function joinTeam(token: string, inviteCode: string): Promise<TeamVO> {
	return request<TeamVO>("/teams/join", {
		method: "POST",
		headers: { ...authHeaders(token), "Content-Type": "application/json" },
		body: JSON.stringify({ invite_code: inviteCode }),
	});
}

export async function leaveTeam(token: string, teamId: number): Promise<void> {
	await request<unknown>(`/teams/${teamId}/leave`, {
		method: "POST",
		headers: authHeaders(token),
	});
}

export async function resetTeamInviteCode(token: string, teamId: number): Promise<string> {
	const data = await request<{ invite_code: string }>(`/teams/${teamId}/reset-invite`, {
		method: "POST",
		headers: authHeaders(token),
	});
	return data.invite_code;
}

export async function removeTeamMember(token: string, teamId: number, userId: number): Promise<void> {
	await request<unknown>(`/teams/${teamId}/members/${userId}`, {
		method: "DELETE",
		headers: authHeaders(token),
	});
}

// ─── User ───

export interface UserInfo {
	id: number;
	username: string;
	nickname: string;
	phone?: string;
	email?: string;
	avatar: string;
	is_active: boolean;
	created_at: string;
}

/** 主动注销 refresh token（登出时调用，失败不阻塞本地清理） */
export async function logoutOnServer(refreshToken: string | undefined): Promise<void> {
	if (!refreshToken) return;
	try {
		const base = await getApiBase();
		await fetch(`${base}/auth/logout`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ refresh_token: refreshToken }),
		});
	} catch {
		// 网络失败也不阻断本地登出
	}
}

export async function fetchOAuthProviders(): Promise<string[]> {
	return request<string[]>("/oauth/providers");
}

export async function fetchOAuthURL(provider: string): Promise<string> {
	const data = await request<{ url: string }>(`/oauth/${provider}/url`);
	return data.url;
}

export async function fetchCurrentUser(token: string): Promise<UserInfo> {
	return request<UserInfo>("/users/me", {
		headers: authHeaders(token),
	});
}

export async function updateProfile(
	token: string,
	data: { nickname?: string; email?: string; avatar?: string },
): Promise<UserInfo> {
	return request<UserInfo>("/users/me", {
		method: "PUT",
		headers: { ...authHeaders(token), "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
}

// ─── Usage series (token activity) ───

export interface UsageSeriesPoint {
	date: string;
	credits: number;
	tokens: number;
	requests: number;
}

export interface UsageSeries {
	points: UsageSeriesPoint[];
	start_time: string;
	end_time: string;
}

export async function fetchUsageSeries(token: string, days: 7 | 30 | 90 | 365 = 30): Promise<UsageSeries> {
	return request<UsageSeries>(`/usage/me/series?days=${days}`, {
		headers: authHeaders(token),
	});
}

// ─── Market Abilities（ADR-0049：Skill / Scene / MCP / Plugin / Bundle 统一为 Ability） ───

export type AbilityType = "skill" | "scene" | "mcp" | "plugin" | "bundle";
/** bundle 不允许嵌套，成员集合恒为一层。 */
export type AbilityMemberType = Exclude<AbilityType, "bundle">;

export interface AbilityMember {
	type: AbilityMemberType;
	slug: string;
	/** 仅 mcp 私有内联成员才有；有它就没有展开字段。 */
	inline?: Record<string, unknown>;
	/** 引用的成员当前是否仍在库；内联成员恒 false。 */
	exists: boolean;
	name: string;
	icon: string;
	version: string;
}

/** raw.config：客户端运行时读，按 type 取不同字段。 */
export interface AbilityConfig {
	/** type=mcp：原样写入 `~/.vetta/agent/mcp.json` 的配置块。 */
	mcp?: Record<string, unknown>;
	/** type=plugin：以 zip 内 plugin.json 为准，admin 不可改。 */
	api_version?: string;
	permissions?: string[];
	commands?: string[];
	/**
	 * type=plugin：插件内聚的 MCP server 与 skill（ADR-0040），上传时从 zip 解析。
	 * 纯展示——运行时装配仍由客户端读安装目录的 plugin.json 完成。
	 */
	contributions?: AbilityPluginContributions;
	/** type=bundle：成员清单。 */
	members?: AbilityMember[];
}

/** 插件内聚的 agent 贡献（对用户不可见地随插件生死，故需在装之前列清楚）。 */
export interface AbilityPluginContributions {
	mcp_servers?: AbilityContributedMcp[];
	skills?: AbilityContributedSkill[];
}

export interface AbilityContributedMcp {
	name: string;
	display_name?: string;
	description?: string;
}

export interface AbilityContributedSkill {
	name: string;
	alias?: string;
	description?: string;
}

export type AbilityShowcaseTemplate = "chat-over-canvas" | "chat-thread";
export type AbilityShowcaseCanvas = "design" | "code" | "docs" | "generic";

export interface AbilityShowcase {
	template: AbilityShowcaseTemplate;
	user_prompt: string;
	assistant_reply: string;
	/** 仅 chat-over-canvas 有意义。 */
	canvas?: AbilityShowcaseCanvas;
	brand_icon_url?: string;
	brand_name?: string;
}

export interface AbilityFeatureItem {
	title: string;
	description: string;
	icon?: string;
}

export interface AbilityStepItem {
	title: string;
	description?: string;
}

export interface AbilityLinkItem {
	label: string;
	href: string;
}

/** 仓库只能声明宿主支持的区块，不能注入 HTML、脚本、样式或任意操作。 */
export type AbilityDetailBlock =
	| { type: "feature-grid"; title?: string; items: AbilityFeatureItem[] }
	| { type: "steps"; title?: string; items: AbilityStepItem[] }
	| { type: "showcase"; showcase: AbilityShowcase }
	| { type: "image"; src: string; alt?: string; caption?: string }
	| { type: "callout"; tone: "info" | "success" | "warning"; title?: string; content: string }
	| { type: "markdown"; content: string }
	| { type: "links"; title?: string; items: AbilityLinkItem[] };

/** 预置元信息键，label 由客户端按 locale 解析。 */
export type AbilityMetaKey = "homepage" | "repository" | "docs" | "license";

/**
 * 一条元信息。刻意是**有序数组**的元素而非对象键值——对象的键顺序在序列化时
 * 不保证，会让详情页字段顺序随机跳动；数组顺序即运营排定的展示顺序。
 */
export interface AbilityMetaEntry {
	/** 预置键；非空时 label 走 i18n，忽略 label 字段。 */
	key?: AbilityMetaKey;
	/** 自定义条目的展示名，仅在无 key 时使用，原样显示不翻译。 */
	label?: string;
	/** 展示值；http(s):// 开头渲染为可点击链接。 */
	value: string;
}

/** raw.detail.i18n[locale]：整体覆盖，不与默认值合并。 */
export interface AbilityDetailLocale {
	name?: string;
	description?: string;
	content?: string;
	showcases?: AbilityShowcase[];
	meta?: AbilityMetaEntry[];
	blocks?: AbilityDetailBlock[];
}

/**
 * raw.detail：全部展示信息的唯一真相源。
 * 顶层字段为默认语言，i18n[locale] 覆盖其它语言，两者同构。
 * MarketAbility 顶层的 name/description 等由服务端从这里投影而来，读哪个都一致。
 */
export interface AbilityDetail {
	name?: string;
	description?: string;
	license?: string;
	author?: string;
	/** 空 / solar:xxx-bold / http(s):// */
	icon?: string;
	tags?: string[];
	showcases?: AbilityShowcase[];
	/** 元信息条目（官网 / 开源协议 / 自定义…），按数组顺序展示。 */
	meta?: AbilityMetaEntry[];
	/** markdown 正文。 */
	content?: string;
	/** 宿主白名单渲染的结构化详情；存在时优先于旧的 showcases + content。 */
	blocks?: AbilityDetailBlock[];
	i18n?: Record<string, AbilityDetailLocale>;
}

export interface MarketAbility {
	/** 机器标识，与 type 联合唯一。 */
	slug: string;
	type: AbilityType;
	name: string;
	description: string;
	license: string;
	version: string;
	author: string;
	/** 四态：空=默认 / solar:xxx-bold / http(s) 外链 / 已解析的绝对图 URL */
	icon: string;
	/** 分类名（服务端已 resolve），未分类为空串。 */
	category: string;
	tags: string[];
	/** 产物摘要，安装前校验；mcp / bundle 恒为空。 */
	sha256: string;
	download_count: number;
	config: AbilityConfig;
	detail: AbilityDetail;
	updated_at: string;
}

function normalizeAbility(item: MarketAbility, icon: string | undefined): MarketAbility {
	return {
		...item,
		icon: icon ?? "",
		tags: item.tags ?? [],
		config: item.config ?? {},
		detail: item.detail ?? {},
	};
}

/** 一次返回五种 type 的已上架能力。 */
export async function fetchMarketAbilities(token: string): Promise<MarketAbility[]> {
	const items = await request<MarketAbility[]>("/abilities/market", {
		headers: authHeaders(token),
	});
	return Promise.all((items ?? []).map(async (item) => normalizeAbility(item, await resolveMarketIconUrl(item.icon))));
}

export async function fetchAbilityInfo(token: string, type: AbilityType, slug: string): Promise<MarketAbility> {
	const item = await request<MarketAbility>(
		`/abilities/${encodeURIComponent(type)}/${encodeURIComponent(slug)}/info`,
		{ headers: authHeaders(token) },
	);
	return normalizeAbility(item, await resolveMarketIconUrl(item.icon));
}

/** mcp / bundle 无产物，服务端直接 400——调用前请自行判断 type。 */
export async function downloadAbility(token: string, type: AbilityType, slug: string): Promise<ArrayBuffer> {
	const serverUrl = await window.vetta.settings.getServerUrl();
	const resp = await fetch(`${serverUrl}/abilities/${encodeURIComponent(type)}/${encodeURIComponent(slug)}/download`, {
		headers: authHeaders(token),
	});
	if (!resp.ok) throw new Error(i18n.t("abilities:error.downloadFailed", { status: resp.status }));
	return resp.arrayBuffer();
}

// ─── MCP 配置适配（能力 → mcp.json 条目） ───

/** mcp 设置页消费的服务器形状：由 MarketAbility 适配而来，不再是独立市场实体。 */
export interface MarketMcpServer {
	/** 列表渲染用的稳定标识，取 ability slug。 */
	id: string;
	name: string;
	display_name: string;
	description: string;
	/** 已解析为可直接渲染的图标值。 */
	icon?: string;
	/** 直接作为 mcpServers[name] 写入本地 mcp.json 的原样配置。 */
	config: Record<string, unknown>;
}

export function abilityToMarketMcpServer(ability: MarketAbility): MarketMcpServer {
	return {
		id: ability.slug,
		name: ability.slug,
		display_name: ability.name,
		description: ability.description,
		icon: ability.icon || undefined,
		config: ability.config.mcp ?? {},
	};
}

/**
 * 将市场实体 icon 解析为 UI 可用值：
 * - 空 → undefined
 * - `solar:xxx` → 原样（由 theme-ui 按 iconify class 渲染）
 * - 绝对/data URL → 原样
 * - 相对路径 → 拼成绝对 URL（供 <img src>）
 */
export async function resolveMarketIconUrl(icon: string | undefined | null): Promise<string | undefined> {
	if (!icon?.trim()) return undefined;
	const trimmed = icon.trim();
	if (trimmed.startsWith("solar:")) {
		return trimmed;
	}
	if (
		trimmed.startsWith("http://") ||
		trimmed.startsWith("https://") ||
		trimmed.startsWith("data:") ||
		trimmed.startsWith("blob:")
	) {
		return trimmed;
	}
	const base = (await getApiBase()).replace(/\/$/, "");
	if (trimmed.startsWith("/")) {
		// base 通常是 https://host/api/v1；相对路径可能是 /api/v1/...
		try {
			const u = new URL(base);
			return `${u.origin}${trimmed}`;
		} catch {
			return `${base}${trimmed}`;
		}
	}
	return `${base}/${trimmed}`;
}

// ─── Notifications (站内信, ADR-0018) ───

export interface NotificationVO {
	id: number;
	type: string;
	title: string;
	body: string;
	payload?: unknown;
	read: boolean;
	created_at: string;
}

export async function fetchNotifications(
	token: string,
	params?: { page?: number; page_size?: number },
): Promise<{ list: NotificationVO[]; total: number; page: number; page_size: number }> {
	const qs = new URLSearchParams();
	if (params?.page) qs.set("page", String(params.page));
	if (params?.page_size) qs.set("page_size", String(params.page_size));
	const suffix = qs.toString() ? `?${qs.toString()}` : "";
	return request<{ list: NotificationVO[]; total: number; page: number; page_size: number }>(
		`/notifications${suffix}`,
		{ headers: authHeaders(token) },
	);
}

export async function fetchNotificationUnread(token: string): Promise<number> {
	const data = await request<{ unread: number }>("/notifications/unread-count", {
		headers: authHeaders(token),
	});
	return data.unread;
}

export async function markNotificationRead(token: string, id: number): Promise<void> {
	await request<unknown>(`/notifications/${id}/read`, {
		method: "POST",
		headers: authHeaders(token),
	});
}

export async function markAllNotificationsRead(token: string): Promise<void> {
	await request<unknown>("/notifications/read-all", {
		method: "POST",
		headers: authHeaders(token),
	});
}

export async function deleteNotification(token: string, id: number): Promise<void> {
	await request<unknown>(`/notifications/${id}`, {
		method: "DELETE",
		headers: authHeaders(token),
	});
}

export async function clearReadNotifications(token: string): Promise<void> {
	await request<unknown>("/notifications/clear-read", {
		method: "POST",
		headers: authHeaders(token),
	});
}
