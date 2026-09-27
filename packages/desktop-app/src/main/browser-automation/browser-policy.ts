import { BrowserAutomationError } from "./contracts.js";

/** 允许通配符：*.github.com 匹配 a.github.com 但不匹配 github.com */
function matchesHost(host: string, pattern: string): boolean {
	if (pattern.startsWith("*.")) {
		const suffix = pattern.slice(1); // ".github.com"
		return host.endsWith(suffix) && host.length > suffix.length;
	}
	return host.toLowerCase() === pattern.toLowerCase();
}

function extractHost(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname;
	} catch {
		// 不是合法 URL，返回原始字符串让下游判定失败
		return url;
	}
}

/** 核心门禁：判定 host 是否在 allowedHosts 中。空数组/undefined → 放行。单元素 "*" → 全放行。 */
function isHostAllowed(host: string, allowedHosts: readonly string[] | undefined): boolean {
	if (!allowedHosts || allowedHosts.length === 0) return true;
	if (allowedHosts.length === 1 && allowedHosts[0] === "*") return true;
	return allowedHosts.some((pattern) => matchesHost(host, pattern));
}

/**
 * 导航前判定：目标 URL 是否在允许列表内。
 * allowedHosts 为空数组或 undefined → 任何 URL 都允许（首次创建时未设置）。
 * 通配符 *.example.com 匹配所有子域但不匹配裸域名。
 * 返回清理后的 URL（trim），抛出 BrowserAutomationError("policy_escape") 表示越界。
 */
export function assertAllowedBrowserUrl(url: string, allowedHosts: readonly string[] | undefined): string {
	const trimmed = url.trim();
	const host = extractHost(trimmed);
	if (!isHostAllowed(host, allowedHosts)) {
		throw new BrowserAutomationError(
			"policy_escape",
			`Host "${host}" is not in allowed hosts [${allowedHosts?.join(", ") ?? "none"}]`,
		);
	}
	return trimmed;
}

/**
 * 引擎返回后二次断言：当前 URL 仍在允许范围内。
 * 越界说明页面 JS 跳了出去 → 调用方应强制关闭会话 + 释放 profile（containPolicyEscape）。
 */
export function assertReturnedPageAllowed(url: string, allowedHosts: readonly string[] | undefined): void {
	const host = extractHost(url);
	if (!isHostAllowed(host, allowedHosts)) {
		throw new BrowserAutomationError(
			"policy_escape",
			`Returned host "${host}" is not in allowed hosts [${allowedHosts?.join(", ") ?? "none"}] — policy escape detected`,
		);
	}
}
