import { describe, expect, it, vi } from "vitest";
import { reactComponentStack } from "../shared/lib/react-error-details";
import { captureReactError } from "./error-monitoring";

const errorInfo = {
	componentStack: "\n    at DesignSystemGrid\n    at Gallery",
} as Parameters<typeof captureReactError>[1];

describe("captureReactError", () => {
	it("把 React 给的组件栈落进渲染日志，并留给错误页复用", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const error = new Error("Minified React error #185; visit https://react.dev/errors/185");

		captureReactError(error, errorInfo);

		const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
		expect(logged).toContain("[react error]");
		expect(logged).toContain("component stack:");
		expect(logged).toContain("at DesignSystemGrid");
		// 错误页在兜底树里读同一份旁路缓存，两边不能各自取一次、又各自落空。
		expect(reactComponentStack(error)).toContain("at DesignSystemGrid");
		spy.mockRestore();
	});
});
