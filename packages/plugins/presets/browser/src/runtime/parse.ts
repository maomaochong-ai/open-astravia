/**
 * agent-browser CLI 输出的解析。
 *
 * 全部按**容错**写：这些 JSON 形状属于上游 CLI 的输出契约，不是我们能钉住的东西。
 * 解析失败时返回空列表而不是抛错——面板显示「暂无数据」远好过整页崩掉，而真正的
 * 失败信号来自 exitCode，由调用方单独处理。
 */

export interface BrowserTabInfo {
	/** 可直接传给 `tab <ref>` 的引用：targetId 优先（跨 daemon 重启稳定），否则 t<N> id。 */
	ref: string;
	title: string;
	url: string;
	active: boolean;
}

export interface BrowserSessionInfo {
	id: string;
	active: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/**
 * 从可能被包裹的 JSON 里取出数组。上游对不同命令用过 `[...]`、`{ tabs: [...] }`、
 * `{ result: [...] }` 几种形状，这里一并容忍。
 */
function extractArray(parsed: unknown, keys: readonly string[]): unknown[] {
	if (Array.isArray(parsed)) return parsed;
	const record = asRecord(parsed);
	if (!record) return [];
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) return value;
	}
	// 再往里一层：{ result: { tabs: [...] } }
	for (const key of ["result", "data"]) {
		const nested = asRecord(record[key]);
		if (!nested) continue;
		for (const inner of keys) {
			const value = nested[inner];
			if (Array.isArray(value)) return value;
		}
	}
	return [];
}

export function parseJson(stdout: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		return null;
	}
}

export function parseTabs(stdout: string): BrowserTabInfo[] {
	const items = extractArray(parseJson(stdout), ["tabs", "items"]);
	const tabs: BrowserTabInfo[] = [];
	for (const item of items) {
		const record = asRecord(item);
		if (!record) continue;
		// 真实输出里两个 id 都有：targetId 跨 daemon 重启稳定，tabId（t1/t2…）是 per-daemon 计数。
		// 两者都能当 tab ref 用，优先取稳定的那个。
		const ref = asString(record.targetId) || asString(record.tabId) || asString(record.id) || asString(record.ref);
		if (ref.length === 0) continue;
		tabs.push({
			ref,
			title: asString(record.title),
			url: asString(record.url),
			active: record.active === true || record.current === true,
		});
	}
	return tabs;
}

export function parseSessions(stdout: string): BrowserSessionInfo[] {
	const items = extractArray(parseJson(stdout), ["sessions", "items"]);
	const sessions: BrowserSessionInfo[] = [];
	for (const item of items) {
		if (typeof item === "string") {
			sessions.push({ id: item, active: false });
			continue;
		}
		const record = asRecord(item);
		if (!record) continue;
		const id = asString(record.id) || asString(record.name) || asString(record.session);
		if (id.length === 0) continue;
		sessions.push({ id, active: record.active === true || record.current === true });
	}
	return sessions;
}

export interface SavedCredential {
	name: string;
	url: string;
	username: string;
}

export function parseAuthProfiles(stdout: string): SavedCredential[] {
	const items = extractArray(parseJson(stdout), ["profiles", "auth", "items"]);
	const profiles: SavedCredential[] = [];
	for (const item of items) {
		if (typeof item === "string") {
			profiles.push({ name: item, url: "", username: "" });
			continue;
		}
		const record = asRecord(item);
		if (!record) continue;
		const name = asString(record.name) || asString(record.profile) || asString(record.id);
		if (name.length === 0) continue;
		profiles.push({ name, url: asString(record.url), username: asString(record.username) });
	}
	return profiles;
}

/**
 * 从 `npm i -g agent-browser` 的输出里判断本机是否已有系统 Chrome。
 *
 * agent-browser 的 postinstall 会明确打印其中一条提示。据此决定要不要再跑一次
 * `agent-browser install`——那一步会下载几百 MB 的 Chrome for Testing，在用户
 * 已经装了 Chrome 时纯属浪费，不能默认就拉。
 *
 * 解析上游控制台文案确实脆弱，所以判不出来时返回 null，由面板降级成「让用户自己决定」，
 * 而不是替他做主。
 */
export function detectSystemChrome(installOutput: string): boolean | null {
	if (/System Chrome found/i.test(installOutput)) return true;
	if (/No Chrome installation detected/i.test(installOutput)) return false;
	return null;
}
