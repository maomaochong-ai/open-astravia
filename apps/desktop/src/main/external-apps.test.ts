import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inferApplicationKind, launchDetached, macosLaunchPlan, windowsLaunchPlan } from "./external-apps.js";

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
		// 终端被当成「其它应用」会拿不到 cwd，而是把目录拼成一条要执行的命令。
		for (const name of [
			"Terminal",
			"iTerm",
			"Warp",
			"Ghostty",
			"Windows Terminal",
			"Windows PowerShell",
			"PowerShell",
			"Command Prompt",
			"Git Bash",
			"cmd.exe",
			"kitty",
			"WezTerm",
		]) {
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
/**
 * macOS 上真正被执行的只有 `open` 一行，参数错了就是默默没反应：
 * `-a` 要接应用路径（bundle id 在部分机器上会失败），目标目录跟在后面。
 */
describe("macosLaunchPlan", () => {
	it("编辑器用 -a 接应用路径，再跟目标目录", () => {
		expect(macosLaunchPlan("/Users/me/My Projects/demo", "/Applications/Cursor.app", "editor")).toEqual({
			command: "open",
			args: ["-a", "/Applications/Cursor.app", "/Users/me/My Projects/demo"],
		});
	});

	it("没有工作区时只启动应用", () => {
		expect(macosLaunchPlan(null, "/Applications/Visual Studio Code.app", "editor")).toEqual({
			command: "open",
			args: ["-a", "/Applications/Visual Studio Code.app"],
		});
	});

	it("访达交给系统默认的目录处理程序", () => {
		expect(macosLaunchPlan("/Users/me/demo", "/System/Library/CoreServices/Finder.app", "file-manager")).toEqual({
			command: "open",
			args: ["/Users/me/demo"],
		});
	});
});

/**
 * Windows 的启动参数是这里最容易错的地方：命令与参数之间没有 shell 帮忙，
 * 目标目录一旦拼错就是一个报错的黑框，用户只会看到「点了一下什么都没发生」。
 */
describe("windowsLaunchPlan", () => {
	const workDir = "C:\\Users\\me\\My Projects\\demo";

	it("终端把目录交给工作目录，不拼进参数", () => {
		for (const exe of [
			"C:\\Windows\\System32\\cmd.exe",
			"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
		]) {
			// 不给参数：cmd / powershell 会把第一个参数当成要执行的命令。
			// 不用 detached：Windows 上的 detached 等于不给它 console，窗口根本不会出现。
			expect(windowsLaunchPlan(workDir, exe, "terminal"), exe).toEqual({
				command: exe,
				args: [],
				cwd: workDir,
				detach: false,
			});
		}
	});

	it("Windows Terminal 用 -d 指定起始目录", () => {
		expect(
			windowsLaunchPlan(workDir, "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe", "terminal"),
		).toEqual({
			command: "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
			args: ["-d", workDir],
		});
	});

	it("资源管理器不弹控制台", () => {
		expect(windowsLaunchPlan(workDir, "C:\\Windows\\explorer.exe", "file-manager")).toEqual({
			command: "C:\\Windows\\explorer.exe",
			args: [workDir],
			hideWindow: true,
		});
	});

	it("编辑器把路径作为参数", () => {
		expect(windowsLaunchPlan(workDir, "C:\\Program Files\\Microsoft VS Code\\Code.exe", "editor")).toEqual({
			command: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
			args: [workDir],
		});
	});

	it("没有工作区时只把应用启动起来", () => {
		expect(windowsLaunchPlan(null, "C:\\Program Files\\Cursor\\Cursor.exe", "editor")).toEqual({
			command: "C:\\Program Files\\Cursor\\Cursor.exe",
			args: [],
		});
		// 终端没有目录可给，也得把控制台窗口开出来。
		expect(windowsLaunchPlan(null, "C:\\Windows\\System32\\cmd.exe", "terminal")).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: [],
			detach: false,
		});
	});
});

/**
 * 编辑器与终端窗口会一直开到用户关它为止：等子进程退出等于让按钮一直转圈。
 */
describe("launchDetached", () => {
	it("长驻进程一启动就返回，不等它退出", async () => {
		const marker = join(tmpdir(), `astravia-detached-${process.pid}-${Date.now()}`);
		await launchDetached({
			command: process.execPath,
			args: ["-e", `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok"), 1200)`],
		});

		// 已经返回，而子进程还在跑：标记文件此时不应该存在。
		expect(existsSync(marker)).toBe(false);

		try {
			const deadline = Date.now() + 8000;
			while (!existsSync(marker) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			expect(existsSync(marker)).toBe(true);
		} finally {
			rmSync(marker, { force: true });
		}
	});

	it("启动失败会报错", async () => {
		await expect(launchDetached({ command: "/definitely/not/installed/editor", args: [] })).rejects.toThrow();
	});
});
