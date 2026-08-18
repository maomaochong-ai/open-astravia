import { describe, expect, it } from "vitest";
import { type ProjectGoneRouteContext, resolveProjectGoneCleanup } from "./project-gone-cleanup";

const PROJECT = "/Users/me/.vetta/workspace/A";
const DEFAULT_CONVERSATION = "/Users/me/.vetta/conversation";

function context(overrides: Partial<ProjectGoneRouteContext> = {}): ProjectGoneRouteContext {
	return {
		currentPath: "/",
		routeCwd: "",
		routeSessionPath: "",
		activeSessionCwd: "",
		activeSessionPath: "",
		defaultConversationCwd: DEFAULT_CONVERSATION,
		...overrides,
	};
}

describe("resolveProjectGoneCleanup", () => {
	it("停在被删项目的新会话页时跳到默认「对话」的新会话页", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			[],
			context({ currentPath: "/new-session/x", routeCwd: PROJECT }),
		);

		expect(result.navigation).toEqual({ kind: "new-session", cwd: DEFAULT_CONVERSATION });
	});

	it("停在被删项目的详情页时同样跳走", () => {
		const result = resolveProjectGoneCleanup(PROJECT, [], context({ currentPath: "/project/x", routeCwd: PROJECT }));

		expect(result.navigation).toEqual({ kind: "new-session", cwd: DEFAULT_CONVERSATION });
	});

	it("会话页展示的是被删项目的会话时，清空 activeSession 并跳走", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			["/shard/a.jsonl"],
			context({ currentPath: "/", activeSessionCwd: PROJECT, activeSessionPath: "/shard/a.jsonl" }),
		);

		expect(result.clearActiveSession).toBe(true);
		expect(result.navigation).toEqual({ kind: "new-session", cwd: DEFAULT_CONVERSATION });
	});

	it("activeSession 的 cwd 已经不带项目信息时，靠会话路径归属判断", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			["/shard/a.jsonl"],
			context({ currentPath: "/", activeSessionPath: "/shard/a.jsonl" }),
		);

		expect(result.clearActiveSession).toBe(true);
		expect(result.navigation).toEqual({ kind: "new-session", cwd: DEFAULT_CONVERSATION });
	});

	it("viewer 页正在看被删项目的会话时跳走", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			["/shard/a.jsonl"],
			context({ currentPath: "/viewer/x", routeSessionPath: "/shard/a.jsonl" }),
		);

		expect(result.navigation).toEqual({ kind: "new-session", cwd: DEFAULT_CONVERSATION });
	});

	it("停在别的项目页面时原地不动", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			[],
			context({ currentPath: "/new-session/x", routeCwd: "/Users/me/.vetta/workspace/B" }),
		);

		expect(result).toEqual({ clearActiveSession: false, navigation: { kind: "stay" } });
	});

	it("会话页展示的是别的项目的会话时原地不动", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			[],
			context({ currentPath: "/", activeSessionCwd: "/Users/me/.vetta/workspace/B" }),
		);

		expect(result).toEqual({ clearActiveSession: false, navigation: { kind: "stay" } });
	});

	it("设置页等无关路由不跳转，但仍清掉属于该项目的 activeSession", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			[],
			context({ currentPath: "/settings/general", activeSessionCwd: PROJECT }),
		);

		expect(result).toEqual({ clearActiveSession: true, navigation: { kind: "stay" } });
	});

	it("默认「对话」cwd 还没解析出来时退回首页", () => {
		const result = resolveProjectGoneCleanup(
			PROJECT,
			[],
			context({ currentPath: "/project/x", routeCwd: PROJECT, defaultConversationCwd: "" }),
		);

		expect(result.navigation).toEqual({ kind: "home" });
	});

	it("空 activeSession 不会因为空串匹配上空的会话路径列表", () => {
		const result = resolveProjectGoneCleanup(PROJECT, [""], context({ currentPath: "/" }));

		expect(result).toEqual({ clearActiveSession: false, navigation: { kind: "stay" } });
	});
});
