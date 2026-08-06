import { describe, expect, it } from "vitest";
import { getFileIcon } from "./fileIcons";

describe("getFileIcon", () => {
	it.each([
		["package.json", "icon-[vscode-icons--file-type-node]"],
		["BUN.LOCK", "icon-[vscode-icons--file-type-bun]"],
		["vite.config.ts", "icon-[vscode-icons--file-type-vite]"],
		["Button.test.tsx", "icon-[vscode-icons--file-type-testts]"],
		["global.d.ts", "icon-[vscode-icons--file-type-typescriptdef]"],
		["Component.tsx", "icon-[vscode-icons--file-type-reactts]"],
		["archive.tar.gz", "icon-[vscode-icons--file-type-zip]"],
		[".env.local", "icon-[vscode-icons--file-type-dotenv]"],
		["unknown.extension", "icon-[vscode-icons--default-file]"],
	])("resolves %s by filename and suffix precedence", (name, expected) => {
		expect(getFileIcon(name, false)).toBe(expected);
	});

	it("uses semantic closed and opened folder icons", () => {
		expect(getFileIcon("components", true, false)).toBe("icon-[vscode-icons--folder-type-component]");
		expect(getFileIcon("Components", true, true)).toBe("icon-[vscode-icons--folder-type-component-opened]");
	});

	it("falls back to the default folder pair", () => {
		expect(getFileIcon("misc", true, false)).toBe("icon-[vscode-icons--default-folder]");
		expect(getFileIcon("misc", true, true)).toBe("icon-[vscode-icons--default-folder-opened]");
	});
});
