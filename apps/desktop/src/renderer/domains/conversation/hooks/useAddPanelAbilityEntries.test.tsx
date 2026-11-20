// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { i18n, initI18n } from "@shared/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddPanelAbilityEntries } from "./useAddPanelAbilityEntries";
import { useSkillIconMap } from "./useSkillIconMap";

vi.mock("@domains/plugins/runtime/plugin-i18n", () => ({
	usePluginTextResolver: () => (_pluginId: string, raw?: string) => raw ?? "",
}));
vi.mock("./useSkillIconMap", () => ({ useSkillIconMap: vi.fn(() => new Map()) }));

initI18n();

const EMPTY_MARKETPLACE = { sources: [], snapshots: [], abilities: [], failedSourceIds: [] };

interface MarketSkillFixture {
	name: string;
	alias: string;
}

function marketSkill(name: string, alias: string): MarketSkillFixture {
	return { name, alias };
}

interface SetupOptions {
	/** `skills.list()` 的结果：模拟扫描到的本地技能（含组合包内成员）。 */
	listedSkills?: unknown[];
	/** GitHub 市场快照：提供 `detail.i18n` 的本地化名称。 */
	marketplace?: unknown;
	/** 安装台账：GitHub 市场的条目要靠它认出「已安装」。 */
	ledger?: Record<string, unknown>;
	/** `mcp.get()` 的结果：市场装的连接器装好后会写进这里。 */
	mcpServers?: Record<string, unknown>;
	/** `plugins.listAll()` 的结果：插件条目要靠它认出「已安装」。 */
	plugins?: unknown[];
}

function setupIpc(skills: MarketSkillFixture[], options: SetupOptions = {}): void {
	const manifest = Object.fromEntries(
		skills.map((skill) => [
			skill.name,
			{
				name: skill.name,
				source: "market",
				enabled: true,
				type: "skill",
				version: "1.0.0",
				installedAt: "2026-10-01T00:00:00.000Z",
				alias: skill.alias,
				marketDescription: `${skill.alias} description`,
			},
		]),
	);
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			abilities: {
				getLedger: vi.fn(async () => options.ledger ?? {}),
				listOpenMarketplaces: vi.fn(async () => options.marketplace ?? EMPTY_MARKETPLACE),
			},
			skills: {
				getMarketManifest: vi.fn(async () => manifest),
				list: vi.fn(async () => options.listedSkills ?? []),
			},
			plugins: { listAll: vi.fn(async () => options.plugins ?? []) },
			mcp: { get: vi.fn(async () => ({ mcpServers: options.mcpServers ?? {} })) },
		},
	});
}

describe("useAddPanelAbilityEntries", () => {
	beforeEach(() => {
		vi.mocked(useSkillIconMap).mockReset();
		vi.mocked(useSkillIconMap).mockReturnValue(new Map());
	});

	const localSkill = (name: string, alias: string) => ({
		name,
		alias,
		description: "",
		source: "user",
		provenance: { kind: "native", scope: "user" },
		type: "skill",
	});

	it("技能自己没有图标时，按名字从市场目录补图标，而不是全落默认图", async () => {
		vi.mocked(useSkillIconMap).mockReturnValue(
			new Map([["skill:cloudflare", "https://example.com/cloudflare.png"]]),
		);
		setupIpc([], { listedSkills: [localSkill("cloudflare", "Cloudflare Platform")] });

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find((candidate) => candidate.label === "Cloudflare Platform");
			expect(entry?.iconUrl).toBe("https://example.com/cloudflare.png");
		}, { timeout: 5000 });
	});

	it("市场目录没有该技能的图标时保持无图标（落默认图）", async () => {
		setupIpc([], { listedSkills: [localSkill("pdf", "PDF Toolkit")] });

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find((candidate) => candidate.label === "PDF Toolkit");
			expect(entry).toBeDefined();
			expect(entry?.icon).toBeUndefined();
			expect(entry?.iconUrl).toBeUndefined();
		}, { timeout: 5000 });
	});

	// 回归：组合包（一包多技能）装好后，包内成员由扫描器报成 `user` 来源、不在清单里。
	// 早期面板只收 `agents-*` / `builtin`，这些成员被整批过滤掉，用户只能看到包本身，
	// 而包内每个技能才是真正要插进消息的东西。
	it("组合包内的成员技能也列进面板", async () => {
		setupIpc([marketSkill("mattpocock-skills", "Matt Pocock Engineering Workflows")], {
			listedSkills: [
				{
					name: "code-review",
					alias: "Code Review",
					description: "两条轴审查",
					source: "user",
					provenance: { kind: "native", scope: "user" },
					type: "skill",
				},
			],
		});

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const member = result.current.find((candidate) => candidate.label === "Code Review");
			expect(member).toBeDefined();
			expect(member?.category).toBe("skill");
		}, { timeout: 5000 });
	});

	// 回归：面板曾经按类型挑来源（连接器只留非市场的），市场装的连接器被整批挡掉，
	// 于是「MCP」分类与「市场」视图里都看不到它，而能力页明明显示已安装。
	it("市场装好的连接器进 MCP 分类，并归到市场来源", async () => {
		setupIpc([], {
			mcpServers: { notion: { type: "http", url: "https://mcp.notion.example/api" } },
			ledger: {
				"mcp:notion": {
					catalogId: "github:astravia-official:mcp:notion",
					version: "1.0.0",
					installedAt: "2026-11-15T00:00:00.000Z",
					origin: { kind: "github-marketplace", sourceId: "astravia-official" },
				},
			},
			marketplace: {
				sources: [],
				failedSourceIds: [],
				abilities: [],
				snapshots: [
					{
						sourceId: "astravia-official",
						repository: "maomaochong-ai/astravia-design-templates",
						marketplaceVersion: "2026.11.15-18",
						syncedAt: "2026-11-15T00:00:00.000Z",
						stale: false,
						source: {
							id: "astravia-official",
							name: "Astravia 官方市场",
							repository: "maomaochong-ai/astravia-design-templates",
							ref: "main",
							enabled: true,
							autoUpdate: true,
							builtin: true,
						},
						abilities: [
							{
								slug: "notion",
								type: "mcp",
								name: "Notion",
								description: "Notion MCP",
								version: "1.0.0",
								license: "MIT",
								author: "Astravia",
								icon: "",
								category: "Productivity",
								categoryI18n: { zh: "效率" },
								tags: [],
								sha256: "",
								configVersion: 1,
								detail: { i18n: { zh: { name: "Notion 连接器" } } },
								origin: { kind: "github-marketplace", sourceId: "astravia-official" },
								listed: true,
								config: { mcp: { type: "http", url: "https://mcp.notion.example/api" } },
							},
						],
					},
				],
			},
		});

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find(
				(candidate) => candidate.category === "mcp" && candidate.id.endsWith(":notion"),
			);
			expect(entry).toBeDefined();
			expect(entry?.groupId).toBe("market");
		}, { timeout: 5000 });
	});

	// 回归：随 App 分发的技能只有 `source === "builtin"` 这一种标记，漏认就全落进「我的」。
	it("随 App 分发的内置技能归入「内置」，不落到「我的」", async () => {
		setupIpc([], {
			listedSkills: [
				{
					name: "astravia-testing",
					alias: "Astravia Testing",
					description: "builtin",
					source: "builtin",
					type: "skill",
				},
			],
		});

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find((candidate) => candidate.label === "Astravia Testing");
			expect(entry?.groupId).toBe("builtin");
		}, { timeout: 5000 });
	});

	// 回归：通用 Agent 技能此前和用户自己装的技能混在「我的」里，看不出它受
	// 「适配通用 Agent Skill」开关控制。
	it("通用 Agent 技能单独成组，不与「我的」混在一起", async () => {
		setupIpc([], {
			listedSkills: [
				{
					name: "agent-skill",
					alias: "Agent Skill",
					description: "from ~/.agents/skills",
					source: "agents-user",
					provenance: { kind: "native", scope: "agents-user" },
					type: "skill",
				},
				{
					name: "my-skill",
					alias: "My Skill",
					description: "user installed",
					source: "user",
					provenance: { kind: "native", scope: "user" },
					type: "skill",
				},
			],
		});

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const agent = result.current.find((candidate) => candidate.label === "Agent Skill");
			const mine = result.current.find((candidate) => candidate.label === "My Skill");
			expect(agent?.groupId).toBe("agents");
			expect(mine?.groupId).toBe("mine");
		}, { timeout: 5000 });
	});

	// 回归：插件贡献的技能正是「插件能被插进对话」的通道（见 ADR-0183）。此前整体按
	// `source !== "plugin"` 排除，插件只剩一行只读条目，点它什么也进不了输入框。
	it("插件贡献的可见技能进技能分类，并且可以插入", async () => {
		setupIpc([], {
			listedSkills: [
				{
					name: "plugin-skill",
					alias: "Plugin Skill",
					description: "from plugin",
					source: "plugin",
					sourcePluginId: "demo-plugin",
					type: "skill",
					presentation: { surfaces: { commandPalette: "visible" } },
				},
			],
		});

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find((candidate) => candidate.label === "Plugin Skill");
			expect(entry?.category).toBe("skill");
			expect(entry?.insertable).toBe(true);
		}, { timeout: 5000 });
	});

	// 回归：插件声明为隐藏的技能不该出现在面板里（默认隐藏是插件的安全默认）。
	it("插件声明在 commandPalette 上隐藏的技能不进面板", async () => {
		setupIpc([], {
			listedSkills: [
				{
					name: "hidden-plugin-skill",
					alias: "Hidden Plugin Skill",
					description: "hidden",
					source: "plugin",
					sourcePluginId: "demo-plugin",
					type: "skill",
					presentation: { surfaces: { commandPalette: "hidden" } },
				},
			],
		});

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			expect(result.current.some((candidate) => candidate.label === "Hidden Plugin Skill")).toBe(false);
		}, { timeout: 5000 });
	});

	// 回归：能力页的标题取市场行的本地化字段；面板只读清单 alias 时同一个包会显示英文名。
	it("技能标题跟随市场目录的界面语言，与能力页一致", async () => {
		setupIpc([marketSkill("mattpocock-skills", "Matt Pocock Engineering Workflows")], {
			ledger: {
				"skill:mattpocock-skills": {
					catalogId: "github:astravia-official:skill:mattpocock-skills",
					version: "1.0.9",
					installedAt: "2026-11-15T00:00:00.000Z",
					origin: { kind: "github-marketplace", sourceId: "astravia-official" },
				},
			},
			marketplace: {
				sources: [],
				failedSourceIds: [],
				abilities: [],
				snapshots: [
					{
						sourceId: "astravia-official",
						repository: "maomaochong-ai/astravia-design-templates",
						source: {
							id: "astravia-official",
							name: "Astravia 官方市场",
							repository: "maomaochong-ai/astravia-design-templates",
							ref: "main",
							enabled: true,
							autoUpdate: true,
							builtin: true,
						},
						marketplaceVersion: "2026.11.15-18",
						syncedAt: "2026-11-15T00:00:00.000Z",
						stale: false,
						abilities: [
							{
								slug: "mattpocock-skills",
								type: "skill",
								name: "Matt Pocock Engineering Workflows",
								description: "English description",
								version: "1.0.9",
								license: "MIT",
								author: "Matt Pocock",
								category: "Development",
								categoryI18n: { zh: "开发" },
								tags: [],
								sha256: "",
								configVersion: 1,
								detail: { i18n: { zh: { name: "Pocock 工程流", description: "中文简介" } } },
								origin: { kind: "github-marketplace", sourceId: "astravia-official" },
								listed: true,
							},
						],
					},
				],
			},
		});

		// 界面语言决定标题：能力页在同一语言下显示「Pocock 工程流」。
		await i18n.changeLanguage("zh");
		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find((candidate) => candidate.id.endsWith(":mattpocock-skills"));
			expect(entry?.label).toBe("Pocock 工程流");
		}, { timeout: 5000 });
	});
});
