// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { initI18n } from "@shared/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddPanelAbilityEntries } from "./useAddPanelAbilityEntries";
import { useSkillIconMap } from "./useSkillIconMap";

vi.mock("@domains/plugins/runtime/plugin-i18n", () => ({
	usePluginTextResolver: () => (_pluginId: string, raw?: string) => raw ?? "",
}));
vi.mock("./useSkillIconMap", () => ({ useSkillIconMap: vi.fn(() => new Map()) }));

initI18n();

interface MarketSkillFixture {
	name: string;
	alias: string;
}

function marketSkill(name: string, alias: string): MarketSkillFixture {
	return { name, alias };
}

function setupIpc(skills: MarketSkillFixture[]): void {
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
			abilities: { getLedger: vi.fn(async () => ({})) },
			skills: {
				getMarketManifest: vi.fn(async () => manifest),
				list: vi.fn(async () => []),
			},
			plugins: { listAll: vi.fn(async () => []) },
			mcp: { get: vi.fn(async () => ({ mcpServers: {} })) },
		},
	});
}

describe("useAddPanelAbilityEntries", () => {
	beforeEach(() => {
		vi.mocked(useSkillIconMap).mockReset();
		vi.mocked(useSkillIconMap).mockReturnValue(new Map());
	});

	it("市场装来的技能从市场目录补图标，而不是全落默认图", async () => {
		vi.mocked(useSkillIconMap).mockReturnValue(
			new Map([["skill:cloudflare", "https://example.com/cloudflare.png"]]),
		);
		setupIpc([marketSkill("cloudflare", "Cloudflare Platform")]);

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find((candidate) => candidate.label === "Cloudflare Platform");
			expect(entry?.iconUrl).toBe("https://example.com/cloudflare.png");
		});
	});

	it("市场目录没有该技能的图标时保持无图标（落默认图）", async () => {
		setupIpc([marketSkill("pdf", "PDF Toolkit")]);

		const { result } = renderHook(() => useAddPanelAbilityEntries(true));
		await waitFor(() => {
			const entry = result.current.find((candidate) => candidate.label === "PDF Toolkit");
			expect(entry).toBeDefined();
			expect(entry?.icon).toBeUndefined();
			expect(entry?.iconUrl).toBeUndefined();
		});
	});
});
