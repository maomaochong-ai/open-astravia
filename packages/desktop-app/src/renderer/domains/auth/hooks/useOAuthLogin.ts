import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * idle：尚未发起，或本次授权已被取消/失败。
 * waiting：已唤起浏览器，正等用户在网页上完成授权。
 */
export type OAuthLoginPhase = "idle" | "waiting";

export interface OAuthLoginModel {
	readonly phase: OAuthLoginPhase;
	/** 失败提示（浏览器唤起失败、回调 state 校验未通过）；空串表示无错误。 */
	readonly error: string;
	readonly start: () => void;
	/** 浏览器没弹出来时重开同一条授权链接。 */
	readonly reopen: () => void;
}

/**
 * 授权登录的发起与等待态，侧边栏授权浮层与引导页登录步共用。
 *
 * 这里不处理登录成功：token 由主进程经 `onOAuthCallback` 广播，
 * 统一在 `useAuth` 落地（写 atom / localStorage / settings）。本 hook 只管
 * 「点了按钮之后到 token 到达之前」这段用户看得见的状态。
 */
export function useOAuthLogin(): OAuthLoginModel {
	const { t } = useTranslation("common");
	const [phase, setPhase] = useState<OAuthLoginPhase>("idle");
	const [error, setError] = useState("");

	// 授权成功后归位，避免下次打开弹窗仍停在上一次的等待态。
	useEffect(() => {
		return window.vetta.auth.onOAuthCallback(() => {
			setPhase("idle");
			setError("");
		});
	}, []);

	// state 校验未通过：浏览器那边显示成功、这边却收不到 token，
	// 必须把等待态收掉并说明原因，否则用户会一直干等。
	useEffect(() => {
		return window.vetta.auth.onOAuthRejected(() => {
			setPhase("idle");
			setError(t("login.rejected"));
		});
	}, [t]);

	const start = useCallback(() => {
		setError("");
		setPhase("waiting");
		window.vetta.auth.startOAuth().catch((e: unknown) => {
			console.error("OAuth login start failed:", e);
			setPhase("idle");
			setError(t("login.openFailed"));
		});
	}, [t]);

	const reopen = useCallback(() => {
		setError("");
		window.vetta.auth.reopenOAuth().catch((e: unknown) => {
			console.error("OAuth login reopen failed:", e);
			setError(t("login.openFailed"));
		});
	}, [t]);

	return { phase, error, start, reopen };
}
