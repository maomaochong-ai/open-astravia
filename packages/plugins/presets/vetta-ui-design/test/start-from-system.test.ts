/**
 * 从风格库开新设计的草稿与参考包清单。
 *
 * 回归的行为：草稿曾把「读 DESIGN.md、拷 theme.css、素材不抄代码」整段协议塞进
 * 用户输入框，又长又脏。现在协议住在 skill 的 design-resources 一节，文件清单落成
 * 参考包里的 INDEX.md，草稿只剩用户的意图一句话。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignResource, DesignSystem } from "../src/design-systems/types";
import {
	buildResourceIndex,
	buildStyleStartDraft,
	DESIGN_RESOURCES_DIR,
	RESOURCE_INDEX_FILE,
	startDesignFromSystem,
} from "../src/gallery/start-from-system";
import { setPluginCtx } from "../src/plugin-context";

function system(resources: DesignResource[] = []): DesignSystem {
	return {
		id: "linear",
		name: "Linear",
		category: "dev",
		vibe: "dark",
		blurb: "blurb",
		resources,
		themeCss: "@theme { --color-primary: #000; }",
		designMd: "# Linear",
	};
}

function textResource(path: string, role?: DesignResource["role"]): DesignResource {
	return { path, ...(role ? { role } : {}), encoding: "text", content: `content of ${path}`, bytes: 10 };
}

describe("buildStyleStartDraft", () => {
	it("只剩意图一句：skill badge + 风格名 + 光标位，跟宿主语言走", () => {
		const zh = buildStyleStartDraft(system(), "zh-CN");
		expect(zh).toBe("@skill:vetta-ui-design 请按「Linear」风格设计。我想做：");
		const en = buildStyleStartDraft(system(), "en");
		expect(en).toBe('@skill:vetta-ui-design Design this in the "Linear" style. I want to build: ');
	});

	it("协议与文件清单不再出现在草稿里——那是 skill 和 INDEX.md 的事", () => {
		for (const locale of ["zh", "en"]) {
			const draft = buildStyleStartDraft(system([textResource("DESIGN.md", "spec")]), locale);
			expect(draft).not.toContain(DESIGN_RESOURCES_DIR);
			expect(draft).not.toContain("theme.css");
			expect(draft).not.toContain("DESIGN.md");
		}
	});
});

describe("buildResourceIndex", () => {
	it("逐个列出实际落盘的文件，并说明目录来历", () => {
		const index = buildResourceIndex("Linear", ["DESIGN.md", "theme.css", "screenshots/home.webp"]);
		expect(index).toContain("# Linear — style reference pack");
		expect(index).toContain("- DESIGN.md");
		expect(index).toContain("- theme.css");
		expect(index).toContain("- screenshots/home.webp");
	});
});

describe("协议真的住在 skill 里", () => {
	// 草稿不再携带协议的前提，是 SKILL.md 按同一套目录/文件名约定写了这条规则。
	// 两边由字符串约定耦合，这里把它钉死：改任何一边名字，这条测试都会叫。
	// vitest 的 cwd 固定在包根（`bun run test` 从这里起），按它定位 skill 文件。
	const skillMd = readFileSync(resolve(process.cwd(), "agent/skills/vetta-ui-design/SKILL.md"), "utf8");

	it("SKILL.md 写明了 design-resources 参考包协议", () => {
		expect(skillMd).toContain(`${DESIGN_RESOURCES_DIR}/`);
		expect(skillMd).toContain(RESOURCE_INDEX_FILE);
		// 协议的三根支柱：读规范、拷主题、素材不抄代码。
		expect(skillMd).toContain("DESIGN.md");
		expect(skillMd).toContain("theme.css");
		expect(skillMd).toMatch(/visual reference only/i);
		// 用户优先于参考包，skill 不该把风格锁死。
		expect(skillMd).toMatch(/user outranks the pack/i);
	});
});

describe("startDesignFromSystem", () => {
	const createProject = vi.fn(async (name: string) => ({ path: `/w/${name}` }));
	const navigationOpen = vi.fn(async () => ({}));
	const writeFile = vi.fn(async () => {});
	const createDirectory = vi.fn(async () => {});

	beforeEach(() => {
		vi.clearAllMocks();
		setPluginCtx({
			fs: { writeFile, createDirectory },
			official: {
				projects: { create: createProject },
				navigation: { open: navigationOpen },
			},
		} as unknown as PluginContext);
	});

	it("资料落盘后写 INDEX.md 清单，草稿只带风格名", async () => {
		await startDesignFromSystem(
			system([textResource("DESIGN.md", "spec"), textResource("theme.css", "theme")]),
			"my-app",
			"zh",
		);
		const indexWrite = writeFile.mock.calls.find(([path]) =>
			(path as unknown as string).endsWith(`/${RESOURCE_INDEX_FILE}`),
		);
		expect(indexWrite?.[0]).toBe(`/w/my-app/${DESIGN_RESOURCES_DIR}/linear/${RESOURCE_INDEX_FILE}`);
		expect(indexWrite?.[1]).toContain("- DESIGN.md");
		expect(indexWrite?.[1]).toContain("- theme.css");
		expect(navigationOpen).toHaveBeenCalledWith({
			target: "new-session",
			cwd: "/w/my-app",
			draft: "@skill:vetta-ui-design 请按「Linear」风格设计。我想做：",
		});
	});

	it("一份资料都没落下来时不写 INDEX.md，免得 skill 引着 agent 去读空包", async () => {
		await startDesignFromSystem(system([]), "my-app", "zh");
		expect(writeFile).not.toHaveBeenCalled();
		expect(navigationOpen).toHaveBeenCalledOnce();
	});
});
