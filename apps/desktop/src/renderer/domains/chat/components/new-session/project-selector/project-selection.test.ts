import { describe, expect, it } from "vitest";
import {
	filterProjects,
	moveHighlight,
	resolveContextCwd,
	resolveInitialSelection,
	selectableProjects,
	shouldShowSearch,
} from "./project-selection";

const DEFAULT_CWD = "/home/u/.vetta/conversation";

const PROJECTS = [
	{ cwd: DEFAULT_CWD, name: "对话", type: "normal", isDefault: true },
	{ cwd: "/w/alpha", name: "Alpha", type: "normal" },
	{ cwd: "/w/beta", name: "Beta", type: "normal" },
	{ cwd: "/w/batch", name: "批量", type: "batch" },
];

describe("selectableProjects", () => {
	it("只保留普通项目：默认「对话」与批量任务项目都不进列表", () => {
		expect(selectableProjects(PROJECTS, DEFAULT_CWD)).toEqual([
			{ cwd: "/w/alpha", name: "Alpha" },
			{ cwd: "/w/beta", name: "Beta" },
		]);
	});

	it("即使默认项目没有 isDefault 标记，也按 cwd 把它挡在列表外", () => {
		const projects = [{ cwd: DEFAULT_CWD, name: "对话", type: "normal" }];
		expect(selectableProjects(projects, DEFAULT_CWD)).toEqual([]);
	});

	it("缺少 name 的项目回落到目录末段，不显示整条绝对路径", () => {
		expect(selectableProjects([{ cwd: "/w/gamma", type: "normal" }], DEFAULT_CWD)).toEqual([
			{ cwd: "/w/gamma", name: "gamma" },
		]);
	});
});

describe("resolveInitialSelection", () => {
	it("从默认「对话」进入时是未选中态", () => {
		expect(
			resolveInitialSelection({ routeCwd: DEFAULT_CWD, defaultConversationCwd: DEFAULT_CWD, projects: PROJECTS }),
		).toBeNull();
	});

	it("从某个项目进入时默认选中该项目", () => {
		expect(
			resolveInitialSelection({ routeCwd: "/w/beta", defaultConversationCwd: DEFAULT_CWD, projects: PROJECTS }),
		).toEqual({ kind: "project", cwd: "/w/beta", name: "Beta" });
	});

	it("路由 cwd 不在可选列表里时仍显示其名字，而不是谎称未选中", () => {
		expect(
			resolveInitialSelection({ routeCwd: "/w/batch", defaultConversationCwd: DEFAULT_CWD, projects: PROJECTS }),
		).toEqual({ kind: "project", cwd: "/w/batch", name: "批量" });
		expect(
			resolveInitialSelection({
				routeCwd: "/tmp/plugin-dir",
				defaultConversationCwd: DEFAULT_CWD,
				projects: PROJECTS,
			}),
		).toEqual({ kind: "project", cwd: "/tmp/plugin-dir", name: "plugin-dir" });
	});

	it("默认 cwd 尚未解析出来时不把空路由当成已选中项目", () => {
		expect(resolveInitialSelection({ routeCwd: "", defaultConversationCwd: "", projects: [] })).toBeNull();
	});
});

describe("resolveContextCwd", () => {
	it("选中项目时上下文跟着切到该项目", () => {
		expect(
			resolveContextCwd({
				selection: { kind: "project", cwd: "/w/alpha", name: "Alpha" },
				routeCwd: DEFAULT_CWD,
				defaultConversationCwd: DEFAULT_CWD,
			}),
		).toBe("/w/alpha");
	});

	it("未选中时落到默认「对话」，即便是从别的项目页进来的", () => {
		expect(resolveContextCwd({ selection: null, routeCwd: "/w/alpha", defaultConversationCwd: DEFAULT_CWD })).toBe(
			DEFAULT_CWD,
		);
	});

	it("待创建项目沿用进页 cwd：目标目录此刻还不存在，不能让 @文件 去读它", () => {
		expect(
			resolveContextCwd({
				selection: { kind: "pending-create", name: "新项目" },
				routeCwd: "/w/alpha",
				defaultConversationCwd: DEFAULT_CWD,
			}),
		).toBe("/w/alpha");
	});
});

describe("filterProjects", () => {
	const options = [
		{ cwd: "/w/alpha", name: "Alpha" },
		{ cwd: "/w/beta", name: "Beta" },
		{ cwd: "/w/gamma", name: "Gamma 项目" },
	];

	it("空查询返回原列表", () => {
		expect(filterProjects(options, "   ")).toEqual(options);
	});

	it("大小写不敏感地按名字做子串匹配", () => {
		expect(filterProjects(options, "ET")).toEqual([{ cwd: "/w/beta", name: "Beta" }]);
	});

	it("匹配不到时返回空列表", () => {
		expect(filterProjects(options, "zzz")).toEqual([]);
	});
});

describe("shouldShowSearch", () => {
	it("超过 5 个项目才出现搜索框", () => {
		expect(shouldShowSearch(5)).toBe(false);
		expect(shouldShowSearch(6)).toBe(true);
	});
});

describe("moveHighlight", () => {
	it("首次向下从第一项开始，首次向上从最后一项开始", () => {
		expect(moveHighlight(-1, 1, 3)).toBe(0);
		expect(moveHighlight(-1, -1, 3)).toBe(2);
	});

	it("到边界后环绕", () => {
		expect(moveHighlight(2, 1, 3)).toBe(0);
		expect(moveHighlight(0, -1, 3)).toBe(2);
	});

	it("候选为空时没有可高亮项", () => {
		expect(moveHighlight(0, 1, 0)).toBe(-1);
	});
});
