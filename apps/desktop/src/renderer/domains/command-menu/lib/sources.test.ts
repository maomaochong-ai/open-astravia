// @vitest-environment jsdom
import type { InstalledPlugin, SkillInfo } from "@preload/api";
import type { Project, RegisteredWorkspaceView } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import type { DesktopSessionSearchResult } from "@/shared/session-search";
import {
	buildInstalledAbilityEntries,
	buildMarketplaceEscapeEntry,
	buildProjectEntries,
	buildSessionEntries,
	buildSettingsEntries,
	buildWorkspaceViewEntries,
	type CommandMenuSourceLabels,
} from "./sources";

const labels: CommandMenuSourceLabels = {
	sessionTypes: { conversation: "Chat", claw: "Claw", project: "Project", batch: "Batch" },
	sessionUnavailable: "No access",
	settingsGroupHint: "Settings",
	abilitySkill: "Skill",
	abilityScene: "Scene",
	abilityPlugin: "Plugin",
	searchMarketplace: "Search the marketplace",
};

function session(overrides: Partial<DesktopSessionSearchResult> = {}): DesktopSessionSearchResult {
	return {
		session: {
			id: "s1",
			path: "/w/a.jsonl",
			cwd: "/w",
			name: "Release plan",
			firstMessage: "",
			modifiedAt: 10,
			access: { readHistory: true, resume: true, rename: true, delete: true },
		},
		sourceCwd: "/w/project-a",
		sourceKind: "project",
		sourceName: "Project A",
		match: { field: "title", snippet: "Release plan" },
		...overrides,
	};
}

describe("buildProjectEntries", () => {
	it("keeps the sidebar ordering and falls back to the directory name", () => {
		const projects: Project[] = [
			{ cwd: "/w/alpha", name: "Alpha", sessionCount: 1, type: "normal" },
			{ cwd: "/w/beta-dir", sessionCount: 0, type: "normal" },
		];
		const entries = buildProjectEntries(projects);

		expect(entries.map((entry) => entry.title)).toEqual(["Alpha", "beta-dir"]);
		expect(entries.map((entry) => entry.order)).toEqual([0, 1]);
		expect(entries[0].action).toEqual({ kind: "openProject", cwd: "/w/alpha" });
		expect(entries[0].id).toBe("project:/w/alpha");
	});
});

describe("buildSessionEntries", () => {
	it("labels the source and preserves the backend ordering", () => {
		const entries = buildSessionEntries([session(), session({ sourceKind: "claw" })], labels);

		expect(entries[0].subtitle).toBe("Project A");
		expect(entries[0].badge).toBe("Project");
		expect(entries[1].badge).toBe("Claw");
		expect(entries.map((entry) => entry.order)).toEqual([0, 1]);
	});

	it("marks an unreachable session as disabled instead of dropping it", () => {
		const locked = session({
			session: {
				...session().session,
				access: { readHistory: false, resume: false, rename: false, delete: false },
			},
		});
		const [entry] = buildSessionEntries([locked], labels);

		expect(entry.disabled).toBe(true);
		expect(entry.disabledReason).toBe("No access");
	});

	it("keeps a history-only session enabled so it can open in the viewer", () => {
		const readOnly = session({
			session: {
				...session().session,
				access: { readHistory: true, resume: false, rename: false, delete: false },
			},
		});
		expect(buildSessionEntries([readOnly], labels)[0].disabled).toBe(false);
	});
});

describe("buildSettingsEntries", () => {
	const visible = { isPersonal: true, hasAuthUser: true, isMac: true, isWindows: false };
	const translate = (key: string) => key;

	it("emits section-level entries that deep link with the section id", () => {
		const entries = buildSettingsEntries(visible, translate);
		const language = entries.find((entry) => entry.id === "settings:appearance-language");

		expect(language).toBeDefined();
		expect(language?.action).toEqual({
			kind: "openSettingsSection",
			tab: "appearance",
			section: "appearance-language",
		});
		expect(language?.subtitle).toBe("tabAppearance");
	});

	it("drops sections whose tab is hidden for this account or platform", () => {
		const anonymous = buildSettingsEntries({ ...visible, hasAuthUser: false }, translate);
		// account 标签 requireAuth，未登录时它的 section 不该出现在搜索结果里。
		expect(anonymous.some((entry) => entry.id === "settings:account-profile")).toBe(false);
		expect(buildSettingsEntries(visible, translate).some((entry) => entry.id === "settings:account-profile")).toBe(
			true,
		);
	});

	it("drops the mcp sections that would redirect away to the abilities page", () => {
		const entries = buildSettingsEntries(visible, translate);
		expect(entries.some((entry) => entry.id.startsWith("settings:mcp-"))).toBe(false);
	});
});

describe("buildWorkspaceViewEntries", () => {
	it("resolves catalog placeholders in the label and points at the plugin view", () => {
		const views = [
			{ pluginId: "git", pluginName: "Git", viewId: "diff", label: "%diff.title%" },
		] as unknown as RegisteredWorkspaceView[];
		const [entry] = buildWorkspaceViewEntries(views, (view) => (view.label === "%diff.title%" ? "Diff" : view.label));

		expect(entry.title).toBe("Diff");
		expect(entry.subtitle).toBe("Git");
		expect(entry.action).toEqual({ kind: "openWorkspaceView", pluginId: "git", viewId: "diff" });
	});
});

describe("buildInstalledAbilityEntries", () => {
	it("covers skills, scenes and plugins with a marketplace-search action carrying the exact name", () => {
		const skills: SkillInfo[] = [
			{ name: "commit", alias: "Commit helper", description: "Write commits", source: "market", type: "skill" },
			{ name: "story", description: "", source: "builtin", type: "scene" },
		];
		const plugins = [{ id: "vetta.git", name: "Git" }] as unknown as InstalledPlugin[];
		const entries = buildInstalledAbilityEntries({ skills, plugins }, labels);

		expect(entries.map((entry) => entry.title)).toEqual(["Commit helper", "story", "Git"]);
		expect(entries.map((entry) => entry.badge)).toEqual(["Skill", "Scene", "Plugin"]);
		expect(entries[0].action).toEqual({ kind: "openAbilities", query: "Commit helper" });
		expect(entries.map((entry) => entry.order)).toEqual([0, 1, 2]);
	});
});

describe("buildMarketplaceEscapeEntry", () => {
	it("pins itself to the bottom and forwards the trimmed query", () => {
		const entry = buildMarketplaceEscapeEntry("  notion  ", labels);
		expect(entry.pinnedToBottom).toBe(true);
		expect(entry.action).toEqual({ kind: "openAbilities", query: "notion" });
	});

	it("omits the query entirely when nothing was typed", () => {
		expect(buildMarketplaceEscapeEntry("   ", labels).action).toEqual({ kind: "openAbilities", query: undefined });
	});
});
