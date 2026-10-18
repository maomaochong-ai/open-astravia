// @vitest-environment jsdom

import { i18n, initI18n } from "@shared/i18n";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberReactComponentStack } from "../lib/react-error-details";
import { useRouteErrorPageModel } from "./useRouteErrorPageModel";

initI18n();

function propsWith(error: Error, extra: Record<string, unknown> = {}) {
	return { error, reset: () => {}, ...extra } as unknown as Parameters<typeof useRouteErrorPageModel>[0];
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useRouteErrorPageModel", () => {
	it("logs the component stack so an update-depth loop names the culprit", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		renderHook(() =>
			useRouteErrorPageModel(
				propsWith(new Error("Minified React error #185"), {
					info: { componentStack: "\n    at DesignSystemGrid\n    at Gallery" },
				}),
			),
		);
		const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
		expect(logged).toContain("[router error] component stack");
		expect(logged).toContain("at DesignSystemGrid");
	});

	it("shows a readable explanation and prefers reload for an update-depth loop", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		await i18n.changeLanguage("zh");
		const error = new Error("Minified React error #185; visit https://react.dev/errors/185");
		rememberReactComponentStack(error, "\n    at QueueCardView\n    at Composer");
		const { result } = renderHook(() => useRouteErrorPageModel(propsWith(error)));

		// 用户不该在主文案里看到 React 的压缩版错误编号。
		expect(result.current.message).not.toContain("Minified React error");
		expect(result.current.message).toContain("#185");
		expect(result.current.labels.bannerTitle).toBe("页面在反复重渲染，已被中止");
		expect(result.current.preferredAction).toBe("reload");
		expect(result.current.details).toContain("at QueueCardView");
		expect(result.current.details).toContain("组件调用栈");
	});

	it("keeps the raw message and retry-first for unknown errors", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		await i18n.changeLanguage("en");
		const reset = vi.fn();
		const error = new Error("Something exploded");
		const { result } = renderHook(() => useRouteErrorPageModel(propsWith(error, { reset })));

		expect(result.current.message).toBe("Something exploded");
		expect(result.current.preferredAction).toBe("retry");
		expect(result.current.details).toBeNull();
		expect(result.current.labels.bannerTitle).toBe("This page ran into a problem");
		result.current.onRetry();
		expect(reset).toHaveBeenCalledTimes(1);
	});

	it("resolves every label from the catalog in both languages", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		for (const language of ["zh", "en"] as const) {
			await i18n.changeLanguage(language);
			for (const error of [new Error("Minified React error #185"), new Error("Minified React error #310"), new Error("boom")]) {
				const { result } = renderHook(() => useRouteErrorPageModel(propsWith(error)));
				for (const [name, value] of Object.entries(result.current.labels)) {
					expect(value, `${language}:${name}`).not.toMatch(/^routeError\./);
					expect(value, `${language}:${name}`).not.toBe("");
				}
			}
		}
	});
});
