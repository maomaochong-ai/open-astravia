import type { PresetError } from "@preload/api.js";
import type { TFunction } from "i18next";

/** 上游用来表达「这把 key 不行」的状态码(Gemini 走 ?key=,无效 key 返回 400)。 */
const AUTH_STATUSES = new Set([400, 401, 403]);

/**
 * 密钥被上游拒绝——调用方据此拒绝启用该服务商。
 *
 * 也认 `http-status` + 认证状态码:主进程与渲染层是分别打包的,用户跑着旧主进程时
 * 拿不到 invalid-key,不该因此把无效 key 放行。
 */
export function isInvalidKey(error: PresetError | undefined): error is PresetError {
	if (!error) return false;
	if (error.code === "invalid-key") return true;
	return error.code === "http-status" && AUTH_STATUSES.has(Number(error.params?.status));
}

/**
 * 把主进程回传的结构化错误翻成界面文案。
 *
 * 主进程拿不到界面语言,只给错误码 + 参数(见 main/models/presets/errors.ts);
 * `detail` 是不翻译的原始信息(如 `net::ERR_CONNECTION_CLOSED`),附在括号里方便排查与上报。
 */
export function translatePresetError(error: PresetError, t: TFunction<"settings">): string {
	const message = t(ERROR_KEYS[error.code], { ...error.params, defaultValue: t("presetErrorNetwork") });
	return error.detail ? `${message}（${error.detail}）` : message;
}

const ERROR_KEYS: Record<PresetError["code"], string> = {
	"unknown-provider": "presetErrorUnknownProvider",
	"missing-key": "presetErrorMissingKey",
	"invalid-key": "presetErrorInvalidKey",
	"http-status": "presetErrorHttpStatus",
	"empty-models": "presetErrorEmptyModels",
	timeout: "presetErrorTimeout",
	network: "presetErrorNetwork",
};
