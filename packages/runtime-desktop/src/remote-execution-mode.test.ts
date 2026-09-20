import { describe, expect, it } from "vitest";
import { assertProjectSupportsExecutionMode, resolveProjectExecutionMode } from "./remote-execution-mode.js";

describe("远程项目的执行模式", () => {
	it("远程会话一律是完全访问：用户默认开着沙箱也不会让核心工具整组消失", () => {
		expect(resolveProjectExecutionMode("ssh://h1/srv/app", "sandbox")).toBe("full-access");
		expect(resolveProjectExecutionMode("ssh://h1/srv/app", undefined)).toBe("full-access");
	});

	it("本地项目原样沿用请求的模式，包括留空交给默认值", () => {
		expect(resolveProjectExecutionMode("/work/app", "sandbox")).toBe("sandbox");
		expect(resolveProjectExecutionMode("/work/app", undefined)).toBeUndefined();
		expect(resolveProjectExecutionMode(undefined, "sandbox")).toBe("sandbox");
	});

	it("会话中途要求远程会话进沙箱时明确拒绝", () => {
		expect(() => assertProjectSupportsExecutionMode("ssh://h1/srv/app", "sandbox")).toThrow(/remote projects/);
		expect(() => assertProjectSupportsExecutionMode("ssh://h1/srv/app", "full-access")).not.toThrow();
		expect(() => assertProjectSupportsExecutionMode("/work/app", "sandbox")).not.toThrow();
	});
});
