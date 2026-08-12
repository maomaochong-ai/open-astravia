/**
 * 重工具的反向触发描述（改造方案 1.1）。
 *
 * 这些工具会在用户工作区里建目录树、跑 npm、覆盖文件，而它们的适用场景与「在现有
 * 代码库里写页面」只隔一层意思。描述里没有明确的排除段时，模型只能靠工具名猜，
 * 误调的代价是用户工作区多出一棵没人要的目录。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { registerDesignTools } from "../src/tools";

interface Registration {
	name: string;
	description?: string;
	side_effect?: "light" | "heavy";
}

const descriptions = new Map<string, string>();
const sideEffects = new Map<string, string | undefined>();

beforeAll(() => {
	const ctx = {
		agent: {
			registerTool: (registration: Registration) => {
				descriptions.set(registration.name, registration.description ?? "");
				sideEffects.set(registration.name, registration.side_effect);
				return { dispose: () => {} };
			},
		},
	} as unknown as PluginContext;
	registerDesignTools(ctx);
});

/** 会写工作区、跑 npm 或覆盖既有文件的工具，逐个点名而不是「全部」——只读工具不该被这条规则绑住。 */
const HEAVY_TOOLS = [
	"vetd_create",
	"vetd_screenshot",
	"vetd_status",
	"vetd_install",
	"vetd_notes",
	"vetd_restore",
] as const;

describe("重工具描述", () => {
	it.each(HEAVY_TOOLS)("%s 带排除场景与唯一正当场景", (name) => {
		const description = descriptions.get(name);
		expect(description, `${name} 没有注册`).toBeDefined();
		expect(description).toMatch(/\bDo NOT use\b/);
		expect(description).toMatch(/\bOnly for\b/);
	});

	it("vetd_create 明确把「已有代码库里写代码」排除掉", () => {
		const description = descriptions.get("vetd_create") ?? "";
		expect(description).toMatch(/existing codebase/);
		// 排除段必须给出替代做法，否则模型只知道不能用这个，不知道该走哪条路。
		expect(description).toMatch(/implement the page directly in that repo's own framework instead/);
	});

	it("在工作区建目录树的工具在注册处声明 heavy，其余不声明（缺省 light）", () => {
		expect(sideEffects.get("vetd_create")).toBe("heavy");
		expect(sideEffects.get("vetd_install")).toBe("heavy");
		// screenshot/status/notes 只读或只改会话内状态；restore 可自愈（恢复前自动落一版历史）。
		expect(sideEffects.get("vetd_screenshot")).toBeUndefined();
		expect(sideEffects.get("vetd_status")).toBeUndefined();
		expect(sideEffects.get("vetd_notes")).toBeUndefined();
	});
});
