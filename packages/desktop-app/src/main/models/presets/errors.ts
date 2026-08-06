/**
 * 预设服务商链路的错误。
 *
 * 主进程不产出面向用户的文案——它拿不到界面语言,也不该把中文写死进 IPC 返回值。
 * 这里只给结构化的错误码 + 参数,由渲染层查 i18n 出文案(见 translatePresetError)。
 * `detail` 是不翻译的原始信息(如 `net::ERR_CONNECTION_CLOSED`),给排查用。
 */
export type PresetErrorCode =
	/** providerId 不在内置目录里。params: provider */
	| "unknown-provider"
	/** 该服务商还没填 API Key。 */
	| "missing-key"
	/** 上游认定这把 key 不可用(各家状态码不一,见 fetch.ts 的 authStatuses)。params: host, status */
	| "invalid-key"
	/** 上游返回其它非 2xx。params: host, status, statusText */
	| "http-status"
	/** 上游 200 但没有可识别的模型。 */
	| "empty-models"
	/** 请求超时。params: seconds */
	| "timeout"
	/** 其它网络/解析失败,detail 带原文。 */
	| "network";

/** 密钥被上游拒绝——调用方据此拒绝启用该服务商。 */
export function isInvalidKey(error: PresetError | undefined): error is PresetError {
	return error?.code === "invalid-key";
}

export interface PresetError {
	code: PresetErrorCode;
	params?: Record<string, string | number>;
	/** 未翻译的原始错误信息,仅用于排查(控制台/日志)。 */
	detail?: string;
}

/** 拉取过程中抛出的、已带错误码的异常。 */
export class PresetFetchError extends Error {
	constructor(readonly presetError: PresetError) {
		super(presetError.detail ?? presetError.code);
		this.name = "PresetFetchError";
	}
}

/** 把任意异常折算成结构化错误:超时单独成码,其余归 network 并保留原文。 */
export function toPresetError(err: unknown, timeoutMs: number): PresetError {
	if (err instanceof PresetFetchError) return err.presetError;
	if (err instanceof Error) {
		if (err.name === "AbortError") return { code: "timeout", params: { seconds: timeoutMs / 1000 } };
		const cause = err.cause instanceof Error ? `：${err.cause.message}` : "";
		return { code: "network", detail: `${err.name}: ${err.message}${cause}` };
	}
	return { code: "network", detail: String(err) };
}
