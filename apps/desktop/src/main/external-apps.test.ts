import { describe, expect, it } from "vitest";
import { inferApplicationKind } from "./external-apps.js";

/**
 * 菜单不再是「系统说谁能开目录」那一条路：本机装了什么编辑器要靠名字认出来。
 * 认错会让 VS Code 被归到「其它应用」排到队尾，等于这次改动没生效。
 */
describe("inferApplicationKind", () => {
	it("认得出常见的代码编辑器", () => {
		for (const name of [
			"Visual Studio Code",
			"Visual Studio Code - Insiders",
			"Cursor",
			"Trae",
			"Qoder IDE",
			"CodeBuddy CN",
			"Sublime Text",
			"Zed",
			"Windsurf",
			"Xcode",
			"IntelliJ IDEA",
			"WebStorm",
			"Android Studio",
		]) {
			expect(inferApplicationKind(name), name).toBe("editor");
		}
	});

	it("认得出终端", () => {
		for (const name of ["Terminal", "iTerm", "Warp", "Ghostty", "Windows Terminal", "kitty", "WezTerm"]) {
			expect(inferApplicationKind(name), name).toBe("terminal");
		}
	});

	it("认得出文件管理器", () => {
		for (const name of ["Finder", "File Explorer", "Nautilus", "Dolphin", "Thunar"]) {
			expect(inferApplicationKind(name), name).toBe("file-manager");
		}
	});

	it("认不出来时不假装是编辑器", () => {
		// 归到其它应用至少不会把它排到编辑器那一队前面去。
		expect(inferApplicationKind("Preview")).toBe("other");
		expect(inferApplicationKind("Fork")).toBe("other");
	});
});
