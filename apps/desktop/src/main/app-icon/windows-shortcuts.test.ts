import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildShortcutRewriteScript,
	shortcutDirectories,
	stableAppIconPath,
	syncWindowsShortcutIcons,
} from "./windows-shortcuts";

describe("stableAppIconPath", () => {
	it("keeps one path across app versions so shortcuts never point into a versioned dir", () => {
		expect(stableAppIconPath("C:/Users/me/AppData/Roaming/Astravia")).toBe(
			join("C:/Users/me/AppData/Roaming/Astravia", "app-icon.ico"),
		);
	});
});

describe("buildShortcutRewriteScript", () => {
	const script = buildShortcutRewriteScript({
		iconPath: "C:/Users/me/AppData/Roaming/Astravia/app-icon.ico",
		appExecutables: ["Astravia.exe"],
		directories: ["C:/pin", "C:/desktop"],
	});

	it("only touches shortcuts whose target is this app", () => {
		// 同一目录下别的应用快捷方式必须原样保留：脚本按 exe 文件名过滤。
		expect(script).toContain("$targets = @('Astravia.exe')");
		expect(script).toContain("if ($targets -notcontains $targetName) { continue }");
	});

	it("skips shortcuts already pointing at the icon and counts the rest", () => {
		expect(script).toContain("if ($shortcut.IconLocation -eq $icon) { continue }");
		expect(script).toContain("$shortcut.IconLocation = $icon");
		expect(script).toContain("Write-Output $changed");
	});

	it("escapes quotes in paths instead of building a broken command", () => {
		const escaped = buildShortcutRewriteScript({
			iconPath: "C:/it's here/app-icon.ico",
			appExecutables: ["Astravia.exe"],
			directories: [],
		});
		expect(escaped).toContain("C:/it''s here/app-icon.ico,0");
	});
});

describe("shortcutDirectories", () => {
	it("covers taskbar pins, the user desktop and the public desktop", () => {
		expect(
			shortcutDirectories({
				APPDATA: "C:/Users/me/AppData/Roaming",
				USERPROFILE: "C:/Users/me",
				PUBLIC: "C:/Users/Public",
			}),
		).toEqual([
			join(
				"C:/Users/me/AppData/Roaming",
				"Microsoft",
				"Internet Explorer",
				"Quick Launch",
				"User Pinned",
				"TaskBar",
			),
			join("C:/Users/me", "Desktop"),
			join("C:/Users/Public", "Desktop"),
		]);
	});

	it("omits directories the environment does not expose", () => {
		expect(shortcutDirectories({})).toEqual([]);
	});
});

describe("syncWindowsShortcutIcons", () => {
	it("copies the selected icon, rewrites shortcuts and refreshes the cache", async () => {
		const runs: string[] = [];
		const copied: Array<[string, string]> = [];
		let refreshed = 0;

		const result = await syncWindowsShortcutIcons({
			iconSourcePath: "C:/app/resources/build/app-icon-icos/coding.ico",
			userDataDir: "C:/tmp/astravia-user-data",
			appExecutables: ["Astravia.exe"],
			directories: ["C:/pin"],
			run: async (script) => {
				runs.push(script);
				return "2\n";
			},
			copyIcon: async (from, to) => void copied.push([from, to]),
			refreshIconCache: async () => {
				refreshed += 1;
			},
			log: () => {},
		});

		// 图标落到稳定路径（不是版本目录），快捷方式才有长期有效的指向。
		expect(copied).toEqual([
			["C:/app/resources/build/app-icon-icos/coding.ico", join("C:/tmp/astravia-user-data", "app-icon.ico")],
		]);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toContain(`${join("C:/tmp/astravia-user-data", "app-icon.ico")},0`);
		expect(refreshed).toBe(1);
		expect(result.changed).toBe(2);
	});

	it("does not refresh the icon cache when nothing was rewritten", async () => {
		let refreshed = 0;
		const result = await syncWindowsShortcutIcons({
			iconSourcePath: "C:/app/resources/build/app-icon-icos/sleep.ico",
			userDataDir: "C:/tmp/astravia-user-data",
			appExecutables: ["Astravia.exe"],
			directories: [],
			run: async () => "0\n",
			copyIcon: async () => {},
			refreshIconCache: async () => {
				refreshed += 1;
			},
			log: () => {},
		});

		expect(refreshed).toBe(0);
		expect(result.changed).toBe(0);
	});
});
