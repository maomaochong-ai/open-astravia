import { describe, expect, it } from "vitest";
import { RUNTIME_HOST_SESSION_PORT_NAMES, type RuntimeHostSessionAssembly } from "../../src/runtime-host/index.js";

type CapabilityStatus = "implemented" | "missing";

/**
 * 可执行的迁移矩阵：新增或删除 RuntimeHost Assembly 能力时必须显式更新。
 * `missing` 不是运行时 fallback；Kernel Backend 在这些能力实现前不能注入 RuntimeHost。
 */
const RUNTIME_CAPABILITY_MATRIX = {
	lifecycle: "implemented",
	historyReader: "implemented",
	historyController: "implemented",
	hostInteraction: "missing",
	executionController: "missing",
	workspaceView: "implemented",
	backgroundWorkController: "missing",
	todoController: "missing",
	configurationController: "missing",
	modelController: "implemented",
	modelView: "implemented",
	corePorts: "implemented",
} as const satisfies Record<keyof RuntimeHostSessionAssembly, CapabilityStatus>;

describe("RuntimeHost capability matrix", () => {
	it("exposes only genuinely implemented assembly capabilities", () => {
		expect(Object.keys(RUNTIME_CAPABILITY_MATRIX)).toEqual(RUNTIME_HOST_SESSION_PORT_NAMES);
		const implemented = Object.entries(RUNTIME_CAPABILITY_MATRIX)
			.filter(([, status]) => status === "implemented")
			.map(([name]) => name);

		expect(implemented).toEqual([
			"lifecycle",
			"historyReader",
			"historyController",
			"workspaceView",
			"modelController",
			"modelView",
			"corePorts",
		]);
		expect(Object.values(RUNTIME_CAPABILITY_MATRIX).filter((status) => status === "missing")).toHaveLength(5);
	});
});
