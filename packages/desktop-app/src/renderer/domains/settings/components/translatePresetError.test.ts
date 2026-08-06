import type { PresetError, PresetErrorCode } from "@preload/api.js";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import zh from "../../../../shared/i18n/locales/zh/settings.json";
import { isInvalidKey, translatePresetError } from "./translatePresetError";

// settings.json 有嵌套段落,这里只取顶层的扁平键(预设错误文案都在这一层)。
const catalog = zh as unknown as Record<string, string>;

/** 极简 i18next 替身:查 zh catalog 并做 {{param}} 插值,缺 key 直接暴露出来。 */
const t = ((key: string, params?: Record<string, unknown>) => {
	const template = catalog[key];
	if (template === undefined) return `MISSING:${key}`;
	return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? `{{${name}}}`));
}) as unknown as TFunction<"settings">;

const ALL_CODES: PresetErrorCode[] = [
	"unknown-provider",
	"missing-key",
	"invalid-key",
	"http-status",
	"empty-models",
	"timeout",
	"network",
];

describe("translatePresetError", () => {
	it("每个错误码都有 zh 文案——主进程新增错误码时别忘了配", () => {
		for (const code of ALL_CODES) {
			const message = translatePresetError({ code } as PresetError, t);
			expect(message, code).not.toContain("MISSING:");
		}
	});

	it("参数被插进文案", () => {
		const message = translatePresetError(
			{ code: "http-status", params: { host: "api.deepseek.com", status: 401, statusText: "Unauthorized" } },
			t,
		);

		expect(message).toBe("api.deepseek.com 返回 401 Unauthorized");
	});

	it("识别密钥被拒:含旧主进程回的 http-status + 认证状态码", () => {
		expect(isInvalidKey({ code: "invalid-key" })).toBe(true);
		// 旧主进程没有 invalid-key,只回 http-status——不能因此把无效 key 放行。
		expect(isInvalidKey({ code: "http-status", params: { status: 401 } })).toBe(true);
		expect(isInvalidKey({ code: "http-status", params: { status: 403 } })).toBe(true);
		expect(isInvalidKey({ code: "http-status", params: { status: 400 } })).toBe(true);
		expect(isInvalidKey({ code: "http-status", params: { status: 503 } })).toBe(false);
		expect(isInvalidKey({ code: "timeout" })).toBe(false);
		expect(isInvalidKey(undefined)).toBe(false);
	});

	it("detail 附在括号里给排查用,不参与翻译", () => {
		const message = translatePresetError({ code: "network", detail: "net::ERR_CONNECTION_CLOSED" }, t);

		expect(message).toBe("网络请求失败（net::ERR_CONNECTION_CLOSED）");
	});
});
