/**
 * 授权登录（deep link）的发起与回调校验。
 *
 * 客户端唯一的登录方式：把用户送到站点授权页，站点授权后 302 到
 * `vetta://oauth/callback?access_token=…&refresh_token=…`，由自定义协议拉回本进程。
 *
 * 这条链路上的 token 是明文走 URL query 的，同机任何注册了 `vetta://` 的程序
 * 都可能投递一个回调进来。故发起时生成一次性 state 塞进 client_redirect，
 * 回调必须带回同一个 state 才被接受——挡掉「客户端并未发起授权时被塞回调」。
 * 注意这挡不住 scheme 劫持本身（PKCE 才能解决），单独排期。
 *
 * state 只存内存：进程重启即失效，此时回调会被丢弃，用户重新点一次登录即可。
 * 落盘反而会削弱它的意义，也多一份需要清理的持久状态。
 */

import { randomUUID } from "node:crypto";
import { DEFAULT_SITE_URL } from "../constants.js";
import { getAppLogger } from "../logger.js";
import { openExternalUrl } from "../open-external.js";

const log = getAppLogger("auth");

const CALLBACK_URL = "vetta://oauth/callback";

/** 本次授权的一次性 state；null 表示当前没有进行中的授权。 */
let pendingState: string | null = null;

export interface OAuthCallbackTokens {
	token: string;
	refreshToken?: string;
}

function buildAuthorizeUrl(state: string): string {
	const clientRedirect = `${CALLBACK_URL}?state=${encodeURIComponent(state)}`;
	return `${DEFAULT_SITE_URL}/auth/deep-link?client_redirect=${encodeURIComponent(clientRedirect)}`;
}

/**
 * 发起授权：生成新 state 并在系统浏览器打开授权页。
 * 重复调用会作废上一次的 state——后发起的那次才算数。
 */
export async function startOAuthLogin(): Promise<void> {
	pendingState = randomUUID();
	await openExternalUrl(buildAuthorizeUrl(pendingState));
}

/**
 * 重新打开当前授权链接，复用同一个 state。
 * 没有进行中的授权时退化为发起一次新的。
 */
export async function reopenOAuthLogin(): Promise<void> {
	if (!pendingState) {
		await startOAuthLogin();
		return;
	}
	await openExternalUrl(buildAuthorizeUrl(pendingState));
}

/**
 * 校验并消费一次回调。
 * 返回 null 表示这次回调不可信（state 缺失或不匹配），调用方必须丢弃其中的 token。
 */
export function consumeOAuthCallback(url: URL): OAuthCallbackTokens | null {
	// 兼容旧参数名 token（API 直接回调）和新参数名 access_token（Next.js oauth-redirect）
	const token = url.searchParams.get("access_token") ?? url.searchParams.get("token");
	if (!token) return null;

	const state = url.searchParams.get("state");
	if (!pendingState || state !== pendingState) {
		log.warn("拒绝 OAuth 回调：state 不匹配（可能来自过期链接、旧标签页或非本次授权）");
		return null;
	}
	pendingState = null;

	const refreshToken = url.searchParams.get("refresh_token");
	return { token, refreshToken: refreshToken ?? undefined };
}
