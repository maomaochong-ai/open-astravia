// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRouteErrorPageModel } from "./useRouteErrorPageModel";

function propsWith(extra: Record<string, unknown> = {}) {
	return {
		error: new Error("Minified React error #185"),
		reset: () => {},
		...extra,
	} as unknown as Parameters<typeof useRouteErrorPageModel>[0];
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useRouteErrorPageModel", () => {
	it("logs the component stack so an update-depth loop names the culprit", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		renderHook(() =>
			useRouteErrorPageModel(
				propsWith({ info: { componentStack: "\n    at DesignSystemGrid\n    at Gallery" } }),
			),
		);
		const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
		expect(logged).toContain("[router error] component stack");
		expect(logged).toContain("at DesignSystemGrid");
		expect(logged).toContain("[router error] stack");
	});

	it("still shows the message and retry action when no stack is available", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const reset = vi.fn();
		const { result } = renderHook(() => useRouteErrorPageModel(propsWith({ reset })));
		expect(result.current.message).toContain("#185");
		result.current.onRetry();
		expect(reset).toHaveBeenCalledTimes(1);
	});
});
