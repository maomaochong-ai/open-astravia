import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	inferApplicationKind,
	launchDetached,
	macosLaunchPlan,
	parseWindowsApplicationEntries,
	parseWindowsShellVerbs,
	windowsApplicationName,
	windowsLaunchPlan,
	windowsProgramsFromExecutables,
} from "./external-apps.js";

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
 * `reg query ...\shell /s` 的输出里，父键的 (Default) 是菜单显示名，命令在子键
 * `\command` 的 (Default) 里。以前把两者当成同一种值，先打印显示名的应用就再也读不到
 * 自己的 exe——装了 VS Code 但菜单里没有它，就是这条路径断了。
 */
describe("parseWindowsShellVerbs", () => {
	it("从 \\command 子键读到 exe，父键的显示名不当成路径", () => {
		const stdout = [
			"HKEY_CLASSES_ROOT\\Directory\\shell\\VSCode",
			"    (Default)    REG_SZ    Open with Code",
			"",
			"HKEY_CLASSES_ROOT\\Directory\\shell\\VSCode\\command",
			'    (Default)    REG_SZ    "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" "C:\\Users\\me\\...\\cli.js" "%V"',
		].join("\r\n");

		const apps = parseWindowsShellVerbs(stdout);
		expect(apps).toHaveLength(1);
		expect(apps[0]).toMatchObject({
			name: "Visual Studio Code",
			applicationPath: "C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
			kind: "editor",
		});
	});

	it("未加引号、路径带空格的命令也能取出 exe", () => {
		const stdout = [
			"HKEY_CLASSES_ROOT\\Directory\\shell\\SublimeText",
			"HKEY_CLASSES_ROOT\\Directory\\shell\\SublimeText\\command",
			"    (Default)    REG_SZ    C:\\Program Files\\Sublime Text\\sublime_text.exe %1",
		].join("\r\n");

		expect(parseWindowsShellVerbs(stdout).map((app) => app.applicationPath)).toEqual([
			"C:\\Program Files\\Sublime Text\\sublime_text.exe",
		]);
	});

	it("同一个 exe 被多个动词登记时只留一行，回调变量会展开", () => {
		const stdout = [
			"HKEY_CLASSES_ROOT\\Directory\\shell\\Code",
			"HKEY_CLASSES_ROOT\\Directory\\shell\\Code\\command",
			'    (Default)    REG_SZ    "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe" "%V"',
			"HKEY_CLASSES_ROOT\\Directory\\shell\\VSCode",
			"HKEY_CLASSES_ROOT\\Directory\\shell\\VSCode\\command",
			'    (Default)    REG_SZ    "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe" "%V"',
		].join("\r\n");

		const apps = parseWindowsShellVerbs(stdout);
		expect(apps).toHaveLength(1);
		expect(apps[0].applicationPath).toBe(
			`${process.env.LOCALAPPDATA ?? "%LOCALAPPDATA%"}\\Programs\\Microsoft VS Code\\Code.exe`,
		);
	});

	it('"在此处打开" 登记之外的键不影响结果', () => {
		expect(parseWindowsShellVerbs("")).toEqual([]);
	});

	/**
	 * 便携版、装在非默认盘位的编辑器不会出现在 App Paths 也不在默认安装目录，
	 * 只在 `HKCR\Applications` 里留一条打开命令。读不出来，菜单就只剩一个文件管理器。
	 */
	describe("parseWindowsApplicationEntries", () => {
		it("从应用自己登记的打开命令里读出 exe", () => {
			const stdout = [
				"HKEY_CLASSES_ROOT\\Applications\\sublime_text.exe",
				"    (Default)    REG_SZ    Sublime Text",
				"HKEY_CLASSES_ROOT\\Applications\\sublime_text.exe\\shell\\open\\command",
				'    (Default)    REG_SZ    "D:\\Tools\\Sublime Text\\sublime_text.exe" "%1"',
			].join("\r\n");

			const apps = parseWindowsApplicationEntries(stdout);
			expect(apps).toHaveLength(1);
			expect(apps[0]).toMatchObject({
				name: "Sublime Text",
				applicationPath: "D:\\Tools\\Sublime Text\\sublime_text.exe",
				kind: "editor",
			});
		});

		it("认不出类型的登记不入菜单：卸载残留会让菜单变垃圾场", () => {
			const stdout = [
				"HKEY_CLASSES_ROOT\\Applications\\some_tool.exe\\shell\\open\\command",
				'    (Default)    REG_SZ    "C:\\Tools\\some_tool.exe" "%1"',
			].join("\r\n");

			expect(parseWindowsApplicationEntries(stdout)).toEqual([]);
		});

		it("同一个 exe 登记在多处只留一行", () => {
			const stdout = [
				"HKEY_CLASSES_ROOT\\Applications\\Cursor.exe\\shell\\open\\command",
				'    (Default)    REG_SZ    "%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe" "%1"',
				"HKEY_CLASSES_ROOT\\Applications\\cursor.exe\\shell\\open\\command",
				'    (Default)    REG_SZ    "%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe" "%1"',
			].join("\r\n");

			expect(parseWindowsApplicationEntries(stdout)).toHaveLength(1);
		});
	});
});

describe("windowsApplicationName", () => {
	it("已知 exe 用友好名称，认不出来的保留文件名", () => {
		expect(windowsApplicationName("C:\\Program Files\\Microsoft VS Code\\Code.exe")).toBe("Visual Studio Code");
		expect(windowsApplicationName("C:\\Users\\me\\scoop\\shims\\code.exe")).toBe("Visual Studio Code");
		expect(windowsApplicationName("C:\\Tools\\Fork\\Fork.exe")).toBe("Fork");
	});

	it("友好名称仍能被归到正确分类", () => {
		expect(inferApplicationKind(windowsApplicationName("C:\\Windows\\System32\\cmd.exe"))).toBe("terminal");
	});
});

/**
 * 用户自装的编辑器不在固定安装目录，也不一定进 App Paths：菜单曾经因此
 * 「检测不到本机编程软件」。目录扫描把两者都盖住，但只能靠 exe 名认应用。
 */
describe("windowsProgramsFromExecutables", () => {
	it("认得按用户装的编辑器与 JetBrains Toolbox 的深路径", () => {
		const apps = windowsProgramsFromExecutables([
			"C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe",
			"C:\\Users\\me\\AppData\\Local\\Programs\\VSCodium\\VSCodium.exe",
			"C:\\Users\\me\\AppData\\Local\\JetBrains\\Toolbox\\apps\\IntelliJ IDEA Ultimate\\ch-0\\243.1\\bin\\idea64.exe",
		]);

		expect(apps.map((app) => app.name)).toEqual(["Cursor", "VSCodium", "IntelliJ IDEA"]);
		expect(apps.every((app) => app.kind === "editor")).toBe(true);
	});

	it("安装器附件与未知 exe 不进菜单", () => {
		const apps = windowsProgramsFromExecutables([
			"C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Uninstall Cursor.exe",
			"C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\crashpad_handler.exe",
			"C:\\Users\\me\\AppData\\Local\\Programs\\autostart-helper.exe",
		]);

		expect(apps).toEqual([]);
	});

	it("同一个 exe 出现两次只留一条", () => {
		const apps = windowsProgramsFromExecutables(["C:\\Apps\\Code.exe", "c:\\apps\\code.exe"]);

		expect(apps).toHaveLength(1);
		expect(windowsApplicationName(apps[0].applicationPath)).toBe("Visual Studio Code");
	});
});

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
