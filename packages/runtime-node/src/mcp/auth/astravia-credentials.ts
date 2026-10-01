/**
 * 读取 Astravia 客户端下沉的登录态。
 *
 * 桌面端登录、刷新、登出时都会把当前 access token 写进 `~/.astravia/auth.json`
 * （见 desktop-app 的 credential-store），这是宿主与外部进程之间唯一的凭据契约：
 * 不去翻客户端的 settings.json，免得把「客户端配置文件的内部结构」变成外部契约。
 *
 * 每次调用都重读文件而不做缓存：token 会轮换，缓存住就等于把过期凭据钉死在
 * 连接上——这正是内建 MCP 从静态 header 改为按请求解析的原因。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AstraviaCredentials {
	/** 服务根，不含 API 前缀 */
	baseUrl: string;
	/** access token，作 Bearer 用 */
	token: string;
}

export const ASTRAVIA_API_PREFIX = "/api/v1";

/** 凭据文件路径：`~/.astravia/auth.json`，显式运行时目录或 ASTRAVIA_HOME 可覆盖根目录。 */
export function astraviaCredentialsPath(astraviaHome?: string): string {
	const home = astraviaHome?.trim() || process.env.ASTRAVIA_HOME?.trim() || join(homedir(), ".astravia");
	return join(home, "auth.json");
}

/**
 * 归一 baseUrl 为**服务根**（不含 API 前缀），拼接一律交给 astraviaApiUrl。
 *
 * 必须容忍两种写法：桌面端注入的 `ASTRAVIA_SERVER_URL` 本身就带 `/api/v1`，
 * 而手工设 `ASTRAVIA_API_BASE_URL` 的人通常只写到域名。两者不统一就会拼出
 * `/api/v1/api/v1/...` 而 404。
 */
export function normalizeAstraviaBaseUrl(raw: string): string {
	return raw.replace(/\/+$/, "").replace(/\/api\/v\d+$/, "");
}

/** 由服务根与端点路径拼出完整 URL。 */
export function astraviaApiUrl(baseUrl: string, path: string): string {
	return `${normalizeAstraviaBaseUrl(baseUrl)}${ASTRAVIA_API_PREFIX}${path}`;
}

/**
 * 读取凭据。环境变量 > 凭据文件；两者都缺时返回 null。
 *
 * 环境变量优先是为 CI 与本地联调留的口子，也让本模块无需真实登录即可测试。
 */
export function loadAstraviaCredentials(astraviaHome?: string): AstraviaCredentials | null {
	const envToken = process.env.ASTRAVIA_API_TOKEN?.trim();
	const envBase = process.env.ASTRAVIA_API_BASE_URL?.trim() || process.env.ASTRAVIA_SERVER_URL?.trim();
	if (envToken && envBase) {
		return { baseUrl: normalizeAstraviaBaseUrl(envBase), token: envToken };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(astraviaCredentialsPath(astraviaHome), "utf8"));
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;

	const record = parsed as Record<string, unknown>;
	const token = envToken || (typeof record.token === "string" ? record.token.trim() : "");
	const baseUrl = envBase || (typeof record.baseUrl === "string" ? record.baseUrl.trim() : "");
	if (!token || !baseUrl) return null;

	return { baseUrl: normalizeAstraviaBaseUrl(baseUrl), token };
}
