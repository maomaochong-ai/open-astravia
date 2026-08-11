/**
 * 新建设计稿的落地方式：只建空项目 + 进新会话页，设计交给 agent。
 *
 * 回归的行为：曾经在这里预铺一份 `.vetd`，用户还没说要画什么，画廊里就先多出一张
 * 空卡片。现在改成把设计 skill 的 badge 预置到输入框，由用户的第一句提示词驱动。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesignProject } from "../src/gallery/gallery-actions";
import { DESIGN_SKILL_DRAFT, startDesignProject } from "../src/gallery/open-project";
import { setPluginCtx } from "../src/plugin-context";

const createProject = vi.fn(async (name: string) => ({ path: `/w/${name}` }));
const navigationOpen = vi.fn(async () => ({}));
const writeFile = vi.fn(async () => {});
const mkdir = vi.fn(async () => {});

beforeEach(() => {
	vi.clearAllMocks();
	setPluginCtx({
		fs: { writeFile, mkdir, readDir: vi.fn(async () => []), exists: vi.fn(async () => false) },
		official: {
			projects: { create: createProject },
			navigation: { open: navigationOpen },
		},
	} as unknown as PluginContext);
});

describe("createDesignProject", () => {
	it("只建项目目录，不预铺 .vetd —— 设计结构由用户的提示词决定", async () => {
		await expect(createDesignProject(" My Design ")).resolves.toEqual({ cwd: "/w/My-Design" });
		expect(createProject).toHaveBeenCalledWith("My-Design");
		expect(writeFile).not.toHaveBeenCalled();
		expect(mkdir).not.toHaveBeenCalled();
	});
});

describe("startDesignProject", () => {
	it("进该项目的新会话页，并把设计 skill 的 badge 预置进输入框", async () => {
		await startDesignProject("/w/my-design");
		expect(navigationOpen).toHaveBeenCalledWith({
			target: "new-session",
			cwd: "/w/my-design",
			draft: DESIGN_SKILL_DRAFT,
		});
	});

	it("badge 用输入框的 skill 软引用文本形态书写，并留出光标位", () => {
		expect(DESIGN_SKILL_DRAFT).toBe("@skill:vetta-ui-design ");
	});
});
