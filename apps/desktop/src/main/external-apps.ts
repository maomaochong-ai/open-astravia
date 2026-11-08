import { execFile, spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExternalApplication, ExternalApplicationKind } from "../preload/api-types/system.js";

const execFileAsync = promisify(execFile);

/** 内置候选应用：在系统里装了才出现在菜单里。 */
interface KnownApplication {
	name: string;
	kind: ExternalApplicationKind;
	/** 依次尝试的安装位置，取第一个存在的。 */
	paths: string[];
}

const KIND_ORDER: Record<ExternalApplicationKind, number> = {
	editor: 0,
	"file-manager": 1,
	terminal: 2,
	other: 3,
};

/**
 * 列出能够打开指定路径的外部应用。
 *
 * 菜单要先有「代码编辑器」，所以不再只信系统登记的打开方式——macOS 上 VS Code
 * 之类不一定登记为目录处理程序，只问 NSWorkspace 经常只回一个 Finder。这里先探测
 * 一队已知的编辑器/终端/文件管理器，再把系统登记的应用补在后面。
 *
 * - macOS: 标准应用目录 + osascript 调 NSWorkspace。
 * - Windows: 常见安装路径 + HKCR\Directory\shell 登记。
 * - Linux: .desktop 文件 + xdg-mime。
 *
 * `targetPath` 为 null（会话没绑定工作区）时只探测本机装了哪些应用。
 */
export async function listExternalApplications(targetPath: string | null): Promise<ExternalApplication[]> {
	const known = await listKnownApplications();
	const declared = targetPath === null ? [] : await listDeclaredApplications(targetPath);
	const merged = known.slice();
	// 系统登记的应用按名称收敛成稳定顺序，接在内置候选后面。
	for (const app of declared.sort((a, b) => a.name.localeCompare(b.name))) {
		if (merged.some((candidate) => sameApplication(candidate, app))) continue;
		merged.push(app);
	}
	// 同名只留一行：`ChatGPT.app` 和它的副本是两份文件，但在菜单里点了效果一样，
	// 并列两行只会让人不知道该选哪个。
	const seen = new Set<string>();
	const unique = merged.filter((app) => {
		const key = app.name.trim().toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	// 内置路径和 App Paths 都没认出编辑器时，再问一次 Windows 自己登记的应用：
	// 便携版、装在非默认盘位的编辑器只在 HKCR\Applications 里留名。
	if (process.platform === "win32" && !unique.some((app) => app.kind === "editor")) {
		for (const app of await listWindowsRegisteredApplications()) {
			if (unique.some((existing) => sameApplication(existing, app))) continue;
			if (unique.some((existing) => existing.name.trim().toLowerCase() === app.name.toLowerCase())) continue;
			unique.push(app);
		}
	}
	// 稳定排序：同分类内保持「内置声明顺序」，VS Code 这类最常用的入口仍在最前。
	return unique.sort(compareApplications);
}

/** 用指定应用打开路径。`targetPath` 为 null 时只把应用启动起来。 */
export async function openPathWithApplication(
	targetPath: string | null,
	appId: string,
	kind: ExternalApplicationKind,
): Promise<void> {
	if (process.platform === "darwin") {
		await openWithMacOS(targetPath, appId, kind);
		return;
	}
	if (process.platform === "win32") {
		await openWithWindows(targetPath, appId, kind);
		return;
	}
	await openWithLinux(targetPath, appId);
}

/** 用系统默认应用打开（探测不到合适应用时的兜底入口）。 */
export async function openPathWithDefaultApplication(targetPath: string): Promise<void> {
	if (process.platform === "darwin") {
		await execFileAsync("open", [targetPath]);
		return;
	}
	if (process.platform === "win32") {
		// explorer.exe 成功也返回非零，且不需要控制台：只关心进程有没有起来。
		await launchDetached({ command: "explorer.exe", args: [targetPath], hideWindow: true });
		return;
	}
	await execFileAsync("xdg-open", [targetPath]);
}

/**
 * 按名称推断用途。系统登记的应用没有分类信息，只能靠名字认——认不出来就归到
 * 「其它」，不假装它是编辑器。
 */
export function inferApplicationKind(name: string): ExternalApplicationKind {
	const lower = name.toLowerCase();
	if (
		/(iterm|terminal|warp|ghostty|alacritty|kitty|wezterm|konsole|tilix|xterm|hyper|powershell|pwsh|git bash|command prompt|\bcmd\b)/.test(
			lower,
		)
	) {
		return "terminal";
	}
	if (
		/(finder|file explorer|nautilus|dolphin|thunar|nemo|caja|pcmanfm|double commander|total commander)/.test(lower)
	) {
		return "file-manager";
	}
	if (
		/(visual studio code|vs ?code|vscodium|cursor|trae|qoder|kiro|codebuddy|sublime|zed|windsurf|nova|xcode|jetbrains|intellij|pycharm|webstorm|goland|phpstorm|rider|datagrip|rubymine|clion|dataspell|aqua|rustrover|appcode|android studio|fleet|emacs|neovim|vim|textmate|bbedit|gedit|kate)/.test(
			lower,
		)
	) {
		return "editor";
	}
	return "other";
}

/** 只按分类排；同分类内保持传入顺序（内置候选的声明顺序）。 */
function compareApplications(a: ExternalApplication, b: ExternalApplication): number {
	return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}

function sameApplication(a: ExternalApplication, b: ExternalApplication): boolean {
	if (process.platform === "win32" || process.platform === "darwin") {
		return a.applicationPath.toLowerCase() === b.applicationPath.toLowerCase();
	}
	return a.id === b.id;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function firstExisting(paths: readonly string[]): Promise<string | null> {
	for (const path of paths) {
		if (await pathExists(path)) return path;
	}
	return null;
}

async function listKnownApplications(): Promise<ExternalApplication[]> {
	const candidates = knownCandidates();
	const resolved = await Promise.all(
		candidates.map(async (candidate) => ({ candidate, path: await firstExisting(candidate.paths) })),
	);
	const known = resolved
		.filter((entry): entry is { candidate: KnownApplication; path: string } => entry.path !== null)
		.map(({ candidate, path }) => ({
			id: path,
			name: candidate.name,
			applicationPath: path,
			kind: candidate.kind,
			isDefault: false,
		}));
	if (process.platform !== "win32") return known;
	// 内置路径只能盖住默认安装位置：便携版、scoop/winget 布局、装在别的盘上的 VS Code
	// 都会漏。App Paths 是 Windows 自己记的「这个 exe 在哪」，拿它兜底。
	for (const app of await listWindowsAppPaths()) {
		if (!known.some((candidate) => sameApplication(candidate, app))) known.push(app);
	}
	// 固定路径与 App Paths 之外还有一份真实位置：按用户装的编辑器在 `%LOCALAPPDATA%\Programs`，
	// JetBrains Toolbox 把 IDE 藏在 `…\Toolbox\apps\<IDE>\ch-0\<ver>\bin`。只列固定路径就会
	// 「检测不到本机编程软件」，所以再扫一遍这两棵目录，用已知 exe 名认应用。
	for (const app of await listWindowsUserPrograms()) {
		if (!known.some((candidate) => sameApplication(candidate, app))) known.push(app);
	}
	// 第三种位置：便携版与解包到任意盘位的编辑器既不在默认目录也不在 App Paths，
	// 只在 `HKCR\Applications` 留一条打开命令。这里按固定 exe 名单去问，
	// 不扫子树，所以可以每次菜单都跑；整棵 `/s` 扫描仍留给后面的最后一级。
	for (const app of await listWindowsRegisteredEditors()) {
		if (!known.some((candidate) => sameApplication(candidate, app))) known.push(app);
	}
	return known;
}

function knownCandidates(): KnownApplication[] {
	if (process.platform === "darwin") return macCandidates();
	if (process.platform === "win32") return windowsCandidates();
	return [];
}

// ─── macOS 实现 ─────────────────────────────────────────────────────

const MAC_APP_DIRS = () => [
	"/Applications",
	join(homedir(), "Applications"),
	"/System/Applications",
	"/System/Applications/Utilities",
];

const MAC_FINDER_APP = "/System/Library/CoreServices/Finder.app";

function macCandidates(): KnownApplication[] {
	const editors = [
		"Visual Studio Code",
		"Cursor",
		"Trae",
		"Trae CN",
		"Qoder IDE",
		"CodeBuddy CN",
		"Windsurf",
		"Sublime Text",
		"Zed",
		"Nova",
		"Xcode",
		"WebStorm",
		"IntelliJ IDEA",
		"PyCharm",
		"GoLand",
		"Android Studio",
	];
	const terminals = ["Terminal", "iTerm", "Warp", "Ghostty", "Alacritty", "kitty", "WezTerm", "Hyper"];
	const dirs = MAC_APP_DIRS();
	const candidates: KnownApplication[] = [
		{ name: "Finder", kind: "file-manager", paths: [MAC_FINDER_APP] },
		...editors.map((name) => ({ name, kind: "editor" as const, paths: dirs.map((dir) => join(dir, `${name}.app`)) })),
		...terminals.map((name) => ({
			name,
			kind: "terminal" as const,
			paths: dirs.map((dir) => join(dir, `${name}.app`)),
		})),
	];
	return candidates;
}

/**
 * 通过 JXA 脚本调用 NSWorkspace，枚举系统登记为可打开该路径的应用。
 * 脚本输入：路径；输出：JSON 数组。
 */
const MACOS_LIST_APPS_SCRIPT = `
ObjC.import('AppKit');
function run(argv) {
  var workspace = $.NSWorkspace.sharedWorkspace;
  var url = $.NSURL.fileURLWithPath(argv[0]);
  var defaultURL = workspace.URLForApplicationToOpenURL(url);
  var defaultPath = defaultURL.isNil() ? '' : ObjC.unwrap(defaultURL.path);
  var urls = workspace.URLsForApplicationsToOpenURL(url);
  var output = [];
  for (var i = 0; i < Math.min(Number(urls.count), 128); i++) {
    var appURL = urls.objectAtIndex(i);
    var bundle = $.NSBundle.bundleWithURL(appURL);
    if (bundle.isNil()) continue;
    var info = ObjC.deepUnwrap(bundle.infoDictionary);
    if (!info || !info.CFBundleIdentifier) continue;
    var path = ObjC.unwrap(appURL.path);
    var localized = bundle.localizedInfoDictionary;
    var localInfo = localized.isNil() ? {} : ObjC.deepUnwrap(localized);
    output.push({
      identity: info.CFBundleIdentifier,
      name: localInfo.CFBundleDisplayName || info.CFBundleDisplayName || info.CFBundleName,
      applicationPath: path,
      isDefault: path === defaultPath,
    });
  }
  return JSON.stringify(output);
}
`;

async function listDeclaredApplications(targetPath: string): Promise<ExternalApplication[]> {
	if (process.platform === "darwin") return listApplicationsMacOS(targetPath);
	if (process.platform === "win32") return listApplicationsWindows(targetPath);
	return listApplicationsLinux(targetPath);
}

async function listApplicationsMacOS(targetPath: string): Promise<ExternalApplication[]> {
	try {
		const { stdout } = await execFileAsync(
			"osascript",
			["-l", "JavaScript", "-e", MACOS_LIST_APPS_SCRIPT, "--", targetPath],
			{
				timeout: 5000,
				maxBuffer: 1024 * 1024,
			},
		);
		const parsed = JSON.parse(stdout.trim()) as Array<{
			identity: string;
			name: string;
			applicationPath: string;
			isDefault: boolean;
		}>;
		return parsed
			.filter(
				(app) =>
					app &&
					typeof app.identity === "string" &&
					typeof app.name === "string" &&
					typeof app.applicationPath === "string",
			)
			.map((app) => ({
				id: app.applicationPath,
				name: app.name,
				applicationPath: app.applicationPath,
				kind: inferApplicationKind(app.name),
				isDefault: Boolean(app.isDefault),
			}));
	} catch {
		return [];
	}
}

/**
 * macOS 侧传给 `open` 的参数。
 *
 * `open` 自己会很快退出，所以仍然用 execFile：应用没了的时候它的报错要能落到用户眼前。
 * `-a` 必须给应用路径——给 bundle id 在部分机器上会直接失败。
 */
export function macosLaunchPlan(
	targetPath: string | null,
	appPath: string,
	kind: ExternalApplicationKind,
): { command: "open"; args: string[] } {
	// 文件管理器交给系统默认的目录处理程序（macOS 上是访达），
	// 免得 `open -a` 把 Finder 当成可启动的应用再判一次。
	if (kind === "file-manager" && targetPath !== null) return { command: "open", args: [targetPath] };
	return { command: "open", args: targetPath === null ? ["-a", appPath] : ["-a", appPath, targetPath] };
}

async function openWithMacOS(targetPath: string | null, appPath: string, kind: ExternalApplicationKind): Promise<void> {
	const plan = macosLaunchPlan(targetPath, appPath, kind);
	await execFileAsync(plan.command, plan.args);
}

// ─── Windows 实现 ───────────────────────────────────────────────────

export function windowsCandidates(): KnownApplication[] {
	const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
	const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
	const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
	const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
	const programs = (name: string): string => join(localAppData, "Programs", name);

	return [
		{
			name: "File Explorer",
			kind: "file-manager",
			paths: [join(systemRoot, "explorer.exe"), "C:\\Windows\\explorer.exe"],
		},
		{
			name: "Visual Studio Code",
			kind: "editor",
			paths: [
				join(programs("Microsoft VS Code"), "Code.exe"),
				join(programFiles, "Microsoft VS Code", "Code.exe"),
				join(programFilesX86, "Microsoft VS Code", "Code.exe"),
			],
		},
		{
			name: "Visual Studio Code Insiders",
			kind: "editor",
			paths: [
				join(programs("Microsoft VS Code Insiders"), "Code - Insiders.exe"),
				join(programFiles, "Microsoft VS Code Insiders", "Code - Insiders.exe"),
			],
		},
		{
			name: "Cursor",
			kind: "editor",
			paths: [
				join(programs("cursor"), "Cursor.exe"),
				join(programFiles, "Cursor", "Cursor.exe"),
				join(programFilesX86, "Cursor", "Cursor.exe"),
			],
		},
		{
			// 国际版与国内版是两个独立安装目录、两个 exe，并列写成一条会让国内版用户
			// 在菜单里看到一个叫「Trae」的条目，误以为是另一个产品。
			name: "Trae",
			kind: "editor",
			paths: [join(programs("Trae"), "Trae.exe")],
		},
		{
			name: "Trae CN",
			kind: "editor",
			paths: [join(programs("Trae CN"), "Trae CN.exe")],
		},
		{
			// Qoder 默认按用户装到 %LOCALAPPDATA%\Programs，企业安装器会落到 Program Files。
			name: "Qoder",
			kind: "editor",
			paths: [
				join(programs("Qoder"), "Qoder.exe"),
				join(programFiles, "Qoder", "Qoder.exe"),
				join(programFilesX86, "Qoder", "Qoder.exe"),
			],
		},
		{
			// Kiro（AWS）同样按用户装到 %LOCALAPPDATA%\Programs\Kiro。
			name: "Kiro",
			kind: "editor",
			paths: [join(programs("Kiro"), "Kiro.exe"), join(programFiles, "Kiro", "Kiro.exe")],
		},
		{
			name: "CodeBuddy",
			kind: "editor",
			paths: [join(programs("CodeBuddy"), "CodeBuddy.exe"), join(programs("CodeBuddy CN"), "CodeBuddy CN.exe")],
		},
		{
			name: "Windsurf",
			kind: "editor",
			paths: [join(programs("Windsurf"), "Windsurf.exe")],
		},
		{
			name: "Zed",
			kind: "editor",
			paths: [join(programs("Zed"), "Zed.exe")],
		},
		{
			name: "Sublime Text",
			kind: "editor",
			paths: [
				join(programFiles, "Sublime Text", "sublime_text.exe"),
				join(programFiles, "Sublime Text 3", "sublime_text.exe"),
				join(programFilesX86, "Sublime Text", "sublime_text.exe"),
				join(programs("Sublime Text"), "sublime_text.exe"),
				join(programs("Sublime Text 3"), "sublime_text.exe"),
				join(localAppData, "Sublime Text", "sublime_text.exe"),
			],
		},
		{
			name: "Windows Terminal",
			kind: "terminal",
			paths: [join(localAppData, "Microsoft", "WindowsApps", "wt.exe")],
		},
		{
			name: "PowerShell",
			kind: "terminal",
			paths: [join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")],
		},
		{
			name: "Command Prompt",
			kind: "terminal",
			paths: [join(systemRoot, "System32", "cmd.exe")],
		},
	];
}

/**
 * Windows 自己记录「已安装、exec 在哪」的权威位置。App Paths 的子键名是 exe 文件名，
 * (Default) 是完整路径，没有嵌套 command 子键，解析不会被显示名干扰。
 *
 * 64/32 位视图都要查：32 位安装器把项写进 Wow6432Node，用单一视图读就会漏掉。
 */
const WINDOWS_APP_PATHS_KEYS = [
	"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
	"HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
];

const WINDOWS_REGISTRY_VIEWS = ["/reg:64", "/reg:32"] as const;
/**
 * `reg query … /s` 会把整棵子树吐出来，超过 Node 默认的 1MB stdout 上限时 execFile 直接报错。
 * 那时整条来源静默归零（菜单里一个应用都没有），而错误又只停在 catch 里。
 */
const WINDOWS_REGISTRY_MAX_BUFFER = 8 * 1024 * 1024;

async function queryWindowsRegistry(args: readonly string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("reg", [...args], {
			timeout: 15_000,
			maxBuffer: WINDOWS_REGISTRY_MAX_BUFFER,
		});
		return stdout;
	} catch {
		// 项不存在、视图不可用、reg 被策略拦下——都当作「这个位置没查出东西」。
		return null;
	}
}

/** 展开注册表里可能出现的 `%ProgramFiles%` 一类变量，不然路径永远指向不存在的文件。 */
export function expandWindowsEnv(value: string): string {
	return value.replace(/%([^%]+)%/g, (match, name: string) => {
		const resolved = process.env[name] ?? process.env[name.toUpperCase()];
		return resolved ?? match;
	});
}

/** 从 shell 命令里取出可执行文件：`"C:\\…\\Code.exe" "…\\cli.js" "%V"` → Code.exe 路径。 */
export function windowsCommandExecutable(command: string): string | null {
	const quoted = command.match(/^"([^"]+\.exe)"/i);
	if (quoted) return quoted[1];
	// 没加引号时路径可能带空格（`C:\Program Files\Foo\foo.exe %1`），
	// 所以要一路取到第一个 .exe 为止，而不是取第一个空格前的 token。
	const bare = command.match(/^(.+?\.exe)(?=\s|$)/i);
	return bare ? bare[1] : null;
}

/**
 * 解析 `reg query HKCR\Directory\shell /s` 的输出。
 *
 * 命令在子键 `\command` 的 (Default) 里，父键的 (Default) 只是菜单显示名；
 * 早期实现把两者当同一种值处理，遇到先打印显示名的情形就再也读不到命令。
 */
export function parseWindowsShellVerbs(stdout: string): ExternalApplication[] {
	const apps: ExternalApplication[] = [];
	const seen = new Set<string>();
	let currentName = "";
	let insideCommand = false;

	for (const line of stdout.split(/\r?\n/)) {
		const keyMatch = line.match(/(?:^|\\)Directory\\shell\\([^\\]+)(\\command)?$/i);
		if (keyMatch) {
			currentName = keyMatch[1];
			insideCommand = Boolean(keyMatch[2]);
			continue;
		}
		if (!insideCommand || !currentName) continue;
		const defaultMatch = line.match(/^\s*\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/i);
		if (!defaultMatch) continue;
		insideCommand = false;
		const exePath = windowsCommandExecutable(expandWindowsEnv(defaultMatch[1].trim()));
		if (exePath === null) continue;
		const pathKey = exePath.toLowerCase();
		if (seen.has(pathKey)) continue;
		seen.add(pathKey);
		const displayName = prettifyWindowsAppName(currentName);
		apps.push({
			id: exePath,
			name: displayName,
			applicationPath: exePath,
			kind: inferApplicationKind(displayName),
			isDefault: false,
		});
	}

	return apps;
}

/**
 * 解析 `HKCR\Applications` 里应用自己登记的打开命令（`<exe>\shell\open\command`）。
 *
 * 这是 App Paths 之外的第二份权威名单：便携版、绿色版、装在任意盘位上的编辑器、
 * 终端都会写这里，而它们既不在默认安装目录也不一定在 App Paths。侧栏菜单只关心
 * 能打开目录的那几类，所以认不出类型的条目一概不入——否则菜单会被卸载残留渡没。
 */
export function parseWindowsApplicationEntries(stdout: string): ExternalApplication[] {
	const apps: ExternalApplication[] = [];
	const seen = new Set<string>();
	let currentExe = "";
	let insideCommand = false;

	for (const line of stdout.split(/\r?\n/)) {
		const keyMatch = line.match(/(?:^|\\)Applications\\([^\\]+)(\\shell\\open\\command)?$/i);
		if (keyMatch) {
			currentExe = keyMatch[1];
			insideCommand = Boolean(keyMatch[2]);
			continue;
		}
		if (!insideCommand || !currentExe) continue;
		const defaultMatch = line.match(/^\s*\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/i);
		if (!defaultMatch) continue;
		insideCommand = false;
		const exePath = windowsCommandExecutable(expandWindowsEnv(defaultMatch[1].trim()));
		if (exePath === null) continue;
		const pathKey = exePath.toLowerCase();
		if (seen.has(pathKey)) continue;
		const name = windowsApplicationName(exePath);
		const kind = inferApplicationKind(name);
		if (kind === "other" && !(currentExe.toLowerCase() in WINDOWS_EXE_NAMES)) continue;
		seen.add(pathKey);
		apps.push({ id: exePath, name, applicationPath: exePath, kind, isDefault: false });
	}

	return apps;
}

async function listApplicationsWindows(_targetPath: string): Promise<ExternalApplication[]> {
	const stdout = await queryWindowsRegistry(["query", "HKCR\\Directory\\shell", "/s"]);
	return stdout === null ? [] : parseWindowsShellVerbs(stdout);
}

/**
 * `HKCR\Applications` 的子键名清单（不带 `/s`）。
 *
 * 不带 `/s` 只列一级子键，一次 reg 调用就能拿到几百个名字；名字就是 exe 文件名，
 * 所以可以先用 `WINDOWS_EXE_NAMES` 白名单筛一遍，再只对认得出的名字取
 * `\shell\open\command`。这样既不用扫整棵子树（好几秒），也不会被卸载残留淹。
 */
export function parseWindowsApplicationsKeyNames(stdout: string): string[] {
	const names: string[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		const match = line.match(/\\Applications\\([^\\]+)$/i);
		if (match) names.push(match[1]);
	}
	return names;
}

/**
 * 按名单查「应用自己登记的打开命令」，只问认得出的 exe。
 *
 * `App Paths` 只收得住「按规范装」的应用；便携版、解包到任意盘位、用绿色包启动的
 * 编辑器只会在 `HKCR\Applications` 里留一条打开命令，而 `%LOCALAPPDATA%\Programs`
 * 目录扫描又碰不到别的盘位。这里补的正是那一段：名单固定、次数固定、不扫子树。
 */
async function listWindowsRegisteredEditors(): Promise<ExternalApplication[]> {
	const knownExeNames = new Set(Object.keys(WINDOWS_EXE_NAMES));
	const apps: ExternalApplication[] = [];
	for (const view of WINDOWS_REGISTRY_VIEWS) {
		const listing = await queryWindowsRegistry(["query", "HKCR\\Applications", view]);
		if (listing === null) continue;
		for (const exeName of parseWindowsApplicationsKeyNames(listing)) {
			if (!knownExeNames.has(exeName.toLowerCase())) continue;
			const command = await queryWindowsRegistry([
				"query",
				`HKCR\\Applications\\${exeName}\\shell\\open\\command`,
				view,
			]);
			if (command === null) continue;
			for (const app of parseWindowsApplicationEntries(command)) {
				if (apps.some((existing) => sameApplication(existing, app))) continue;
				if (!(await pathExists(app.applicationPath))) continue;
				apps.push(app);
			}
		}
	}
	return apps;
}

/**
 * 上面那个人名单都没认出编辑器时的最后一级：`/s` 扫整棵 `HKCR\Applications`。
 *
 * 它是好几秒的活，菜单不能为它付常规代价，所以只在「一个编辑器都没有」时跑。
 */
async function listWindowsRegisteredApplications(): Promise<ExternalApplication[]> {
	const apps: ExternalApplication[] = [];
	for (const view of WINDOWS_REGISTRY_VIEWS) {
		const stdout = await queryWindowsRegistry(["query", "HKCR\\Applications", "/s", view]);
		if (stdout === null) continue;
		for (const app of parseWindowsApplicationEntries(stdout)) {
			if (apps.some((existing) => sameApplication(existing, app))) continue;
			if (!(await pathExists(app.applicationPath))) continue;
			apps.push(app);
		}
	}
	return apps;
}

/**
 * 枚举 App Paths 里登记的应用，只留下真实存在的 exe——注册表里会残留卸载后的条目。
 * 名字优先用已知 exe 的友好名，否则退回文件名，避免菜单里出现 `code.exe`。
 */
async function listWindowsAppPaths(): Promise<ExternalApplication[]> {
	const paths = new Map<string, string>();
	for (const key of WINDOWS_APP_PATHS_KEYS) {
		for (const view of WINDOWS_REGISTRY_VIEWS) {
			const stdout = await queryWindowsRegistry(["query", key, "/s", view]);
			if (stdout === null) continue;
			let currentExe = "";
			for (const line of stdout.split(/\r?\n/)) {
				const keyMatch = line.match(/App Paths\\([^\\]+)$/i);
				if (keyMatch) {
					currentExe = keyMatch[1];
					continue;
				}
				if (!currentExe) continue;
				const defaultMatch = line.match(/^\s*\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/i);
				if (!defaultMatch) continue;
				currentExe = "";
				const exePath = expandWindowsEnv(defaultMatch[1].trim());
				if (!/\.exe$/i.test(exePath)) continue;
				paths.set(exePath.toLowerCase(), exePath);
			}
		}
	}

	const apps: ExternalApplication[] = [];
	for (const exePath of paths.values()) {
		if (!(await pathExists(exePath))) continue;
		const name = windowsApplicationName(exePath);
		apps.push({
			id: exePath,
			name,
			applicationPath: exePath,
			kind: inferApplicationKind(name),
			isDefault: false,
		});
	}
	return apps;
}

/** exe 文件名 → 菜单里的显示名。认不出来的保留文件名，不要凭空编一个。 */
const WINDOWS_EXE_NAMES: Record<string, string> = {
	"code.exe": "Visual Studio Code",
	"code - insiders.exe": "Visual Studio Code Insiders",
	"vscodium.exe": "VSCodium",
	"cursor.exe": "Cursor",
	"trae.exe": "Trae",
	"trae cn.exe": "Trae CN",
	"windsurf.exe": "Windsurf",
	"zed.exe": "Zed",
	"sublime_text.exe": "Sublime Text",
	"qoder.exe": "Qoder IDE",
	"codebuddy.exe": "CodeBuddy",
	"codebuddy cn.exe": "CodeBuddy CN",
	// Kiro 是 AWS 的编辑器，安装目录与 exe 名都是 Kiro。少了这一行，目录扫描能
	// 找到文件也会因为「叫不出名字」而被白名单滤掉。
	"kiro.exe": "Kiro",
	// JetBrains 安装器同时保留 32/64 位 exe，Toolbox 装的则是 idea.exe 这种短名。
	"idea64.exe": "IntelliJ IDEA",
	"idea.exe": "IntelliJ IDEA",
	"webstorm64.exe": "WebStorm",
	"webstorm.exe": "WebStorm",
	"pycharm64.exe": "PyCharm",
	"pycharm.exe": "PyCharm",
	"goland64.exe": "GoLand",
	"goland.exe": "GoLand",
	"datagrip64.exe": "DataGrip",
	"rider64.exe": "Rider",
	"rubymine64.exe": "RubyMine",
	"phpstorm64.exe": "PhpStorm",
	"studio64.exe": "Android Studio",
	// JetBrains 全家桶里剩下的几个：没列到的 exe 名会被白名单过滤，用户装了也看不到。
	"clion64.exe": "CLion",
	"clion.exe": "CLion",
	"dataspell64.exe": "DataSpell",
	"aqua64.exe": "Aqua",
	"rustrover64.exe": "RustRover",
	"appcode64.exe": "AppCode",
	"fleet.exe": "Fleet",
	"wt.exe": "Windows Terminal",
	"powershell.exe": "PowerShell",
	"pwsh.exe": "PowerShell",
	"cmd.exe": "Command Prompt",
	"bash.exe": "Git Bash",
};

/** 已知 exe 的友好名；不认识的返回 null（菜单不能凭空给应用命名）。 */
export function windowsKnownApplicationName(exePath: string): string | null {
	const file = exePath.split(/[\\/]/).pop() ?? exePath;
	return WINDOWS_EXE_NAMES[file.toLowerCase()] ?? null;
}

export function windowsApplicationName(exePath: string): string {
	const file = exePath.split(/[\\/]/).pop() ?? exePath;
	return windowsKnownApplicationName(exePath) ?? file.replace(/\.exe$/i, "");
}

/**
 * 只把认得出名字的 exe 变成菜单项。
 *
 * 目录扫描会碰到 install、uninstall、crashpad_handler 这类东西：它们也是 .exe，
 * 但都不是用户想拿来开目录的应用，靠 `WINDOWS_EXE_NAMES` 白名单滤掉最安全。
 */
export function windowsProgramsFromExecutables(executables: readonly string[]): ExternalApplication[] {
	const apps: ExternalApplication[] = [];
	const seen = new Set<string>();
	for (const exePath of executables) {
		const name = windowsKnownApplicationName(exePath);
		if (name === null) continue;
		const kind = inferApplicationKind(name);
		if (kind === "other") continue;
		const key = exePath.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		apps.push({ id: exePath, name, applicationPath: exePath, kind, isDefault: false });
	}
	return apps;
}

/**
 * Windows 上「自己装的应用」不在默认安装位置、也不一定进 App Paths：
 * Cursor / VSCodium 这类按用户装的编辑器在 `%LOCALAPPDATA%\Programs`，
 * JetBrains Toolbox 把 IDE 放在 `…\Toolbox\apps\<IDE>\ch-0\<ver>\bin`，
 * 而 JetBrains 自己的安装器建的是 `C:\Program Files\JetBrains\<IDE> <ver>\bin`。
 * 只靠固定路径列表就会「检测不到本机编程软件」，所以再按目录扫一遍。
 *
 * `depth` 是「从 root 往下最多走几层目录」，exe 所在目录必须落在预算内：
 * `collectWindowsExecutables` 只在 `level + 1 < depth` 时把子目录入队，
 * 所以 exe 在第四层目录里就要给 depth = 5。Toolbox 曾经写成 4，
 * 结果 `…\<ver>\bin` 永远没被打开，Toolbox 装的 IDE 一个都扫不到。
 */
export const windowsProgramScanRoots = (): Array<{ root: string; depth: number }> => {
	const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
	const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
	const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
	return [
		// `…\Programs\<产品>\<产品>.exe`：exe 在第二层目录。
		{ root: join(localAppData, "Programs"), depth: 2 },
		// `…\Toolbox\apps\<IDE>\ch-0\<ver>\bin\*.exe`：exe 在第四层。
		{ root: join(localAppData, "JetBrains", "Toolbox", "apps"), depth: 5 },
		// `C:\Program Files\JetBrains\<IDE> <ver>\bin\*.exe`：exe 在第二层。
		{ root: join(programFiles, "JetBrains"), depth: 3 },
		{ root: join(programFilesX86, "JetBrains"), depth: 3 },
	];
};

/** 单次扫描的目录预算：Programs 下偶尔会有构建缓存这类深目录，菜单不能为它卡住。 */
const WINDOWS_PROGRAM_SCAN_BUDGET = 400;

export async function collectWindowsExecutables(root: string, depth: number): Promise<string[]> {
	const found: string[] = [];
	const queue: Array<{ dir: string; level: number }> = [{ dir: root, level: 0 }];
	let budget = WINDOWS_PROGRAM_SCAN_BUDGET;
	while (queue.length > 0 && budget > 0) {
		const next = queue.shift();
		if (!next) break;
		budget -= 1;
		let entries: Dirent[];
		try {
			entries = await readdir(next.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(next.dir, entry.name);
			if (entry.isDirectory()) {
				if (next.level + 1 < depth) queue.push({ dir: full, level: next.level + 1 });
				continue;
			}
			if (/\.exe$/i.test(entry.name)) found.push(full);
		}
	}
	return found;
}

async function listWindowsUserPrograms(): Promise<ExternalApplication[]> {
	const executables: string[] = [];
	for (const { root, depth } of windowsProgramScanRoots()) {
		executables.push(...(await collectWindowsExecutables(root, depth)));
	}
	const apps: ExternalApplication[] = [];
	for (const app of windowsProgramsFromExecutables(executables)) {
		// 目录枚举与菜单点击之间可能差很久，exe 已被卸载的不进菜单。
		if (!(await pathExists(app.applicationPath))) continue;
		apps.push(app);
	}
	return apps;
}

function prettifyWindowsAppName(registryKey: string): string {
	// 常见 shell 动词映射为友好名称
	const known: Record<string, string> = {
		open: "File Explorer",
		explore: "File Explorer",
		git_shell: "Git Bash",
		git_gui: "Git GUI",
		Code: "Visual Studio Code",
		vscode: "Visual Studio Code",
		terminal: "Terminal",
		wt: "Windows Terminal",
	};
	const lower = registryKey.toLowerCase();
	for (const [key, label] of Object.entries(known)) {
		if (lower.includes(key)) return label;
	}
	// 去掉前缀动词如 "open with "、"openin"、"openwith"
	const cleaned = registryKey
		.replace(/^open\s*with\s*/i, "")
		.replace(/^open\s*in\s*/i, "")
		.replace(/^open\s*/i, "")
		.replace(/^edit\s*/i, "")
		.replace(/[-_]/g, " ")
		.trim();
	return cleaned || registryKey;
}

/** 怎么把一个程序交给 Windows：命令、参数、起始目录。 */
export interface LaunchPlan {
	command: string;
	args: string[];
	/** 仅终端有意义：控制台窗口直接开在这个目录里。 */
	cwd?: string;
	/** explorer 这类宿主不需要控制台，别让黑框闪一下。 */
	hideWindow?: boolean;
	/**
	 * 默认交给系统独立处理（窗口活过本进程）。控制台程序必须关掉：Windows 上的 detached
	 * 等于不给子进程分配 console，cmd / powershell 会变成一个看不见的隐形窗口。
	 */
	detach?: boolean;
}

/**
 * 把进程交出去就算成功，不等它退出。
 *
 * 编辑器/终端这类 GUI 程序的进程会一直活到窗口关闭，用 execFile 等它退出等于让
 * 「打开中」一直转圈；explorer.exe 这类宿主更是成功也返回非零。我们只关心进程有
 * 没有起来（ENOENT / EACCES 能报出来），剩下的交给窗口自己。
 */
export function launchDetached(plan: LaunchPlan): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(plan.command, plan.args, {
			cwd: plan.cwd,
			detached: plan.detach ?? true,
			stdio: "ignore",
			windowsHide: plan.hideWindow ?? false,
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

/**
 * 决定怎么启动这个应用。
 *
 * 几个由系统语义决定的特殊处理：
 * - `explorer.exe` 成功也返回非零，且不需要控制台；
 * - `wt.exe` 用 `-d` 指定起始目录，把路径当参数丢给它只会被当成待执行命令；
 * - `cmd.exe` / `powershell.exe` 把第一个参数当成要执行的命令，把目录拼进参数只会
 *   得到一句「不是内部或外部命令」——终端不给参数，用 `cwd` 落地。
 */
export function windowsLaunchPlan(
	targetPath: string | null,
	appPath: string,
	kind: ExternalApplicationKind,
): LaunchPlan {
	// 不能依赖 basename：它认的是当前平台的分隔符，而这里判断的是 Windows 路径。
	const exe = appPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
	if (exe === "wt.exe") return { command: appPath, args: targetPath === null ? [] : ["-d", targetPath] };
	if (exe === "explorer.exe" && targetPath !== null) {
		return { command: appPath, args: [targetPath], hideWindow: true };
	}
	if (kind === "terminal") {
		return { command: appPath, args: [], cwd: targetPath ?? undefined, detach: false };
	}
	if (targetPath === null) return { command: appPath, args: [] };
	return { command: appPath, args: [targetPath] };
}

async function openWithWindows(
	targetPath: string | null,
	appPath: string,
	kind: ExternalApplicationKind,
): Promise<void> {
	// 直接起可执行文件，不经 powershell：参数由 spawn 逐个传递，不必再拼命令行。
	await launchDetached(windowsLaunchPlan(targetPath, appPath, kind));
}

// ─── Linux 实现 ─────────────────────────────────────────────────────

interface DesktopEntry {
	id: string;
	name: string;
	exec: string;
	icon?: string;
	handlesDirectory: boolean;
}

const LINUX_DESKTOP_DIRS = () => [
	join(homedir(), ".local", "share", "applications"),
	"/usr/share/applications",
	"/usr/local/share/applications",
];

/**
 * 扫描系统与用户的 .desktop 文件，筛选声明能处理 inode/directory 的条目。
 * 默认应用通过 xdg-mime 查询。
 */
async function listApplicationsLinux(_targetPath: string): Promise<ExternalApplication[]> {
	const entries: DesktopEntry[] = [];
	for (const dir of LINUX_DESKTOP_DIRS()) {
		try {
			const files = await readdir(dir);
			for (const file of files) {
				if (!file.endsWith(".desktop")) continue;
				try {
					const content = await readFile(join(dir, file), "utf-8");
					const entry = parseDesktopEntry(file, content);
					if (entry?.handlesDirectory) {
						entries.push(entry);
					}
				} catch {
					// 跳过无法读取的 desktop 文件
				}
			}
		} catch {
			// 目录不存在时跳过
		}
	}

	let defaultId = "";
	try {
		const { stdout } = await execFileAsync("xdg-mime", ["query", "default", "inode/directory"], {
			timeout: 3000,
		});
		defaultId = stdout.trim();
	} catch {
		// xdg-mime 不可用时不标记默认
	}

	return entries.map((entry) => ({
		id: entry.exec,
		name: entry.name,
		applicationPath: entry.exec,
		kind: inferApplicationKind(entry.name),
		isDefault: entry.id === defaultId,
	}));
}

function parseDesktopEntry(filename: string, content: string): DesktopEntry | null {
	// 只取 [Desktop Entry] 段，忽略其它段
	const sectionMatch = content.match(/\[Desktop Entry\][\s\S]*?(?=\n\[|$)/);
	if (!sectionMatch) return null;
	const section = sectionMatch[0];

	const getValue = (key: string): string | undefined => {
		const m = section.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
		return m ? m[1].trim() : undefined;
	};

	const name = getValue("Name");
	const exec = getValue("Exec");
	const mimeTypes = getValue("MimeType") ?? "";
	const noDisplay = getValue("NoDisplay") === "true";
	const hidden = getValue("Hidden") === "true";

	if (!name || !exec || noDisplay || hidden) return null;

	const handlesDirectory = /inode\/directory/i.test(mimeTypes) || /x-directory\/normal/i.test(mimeTypes);
	// Exec 中的 %f %F %u %U 等占位符在执行时由调用方替换；这里仅取可执行命令
	const execClean = exec.replace(/%[fFuUdDnNickvm]/g, "").trim();

	return {
		id: filename.replace(/\.desktop$/, ""),
		name,
		exec: execClean,
		icon: getValue("Icon"),
		handlesDirectory,
	};
}

async function openWithLinux(targetPath: string | null, appId: string): Promise<void> {
	// appId 是清理过的 Exec 命令（不含 %f 占位符）；把目标路径作为参数传入
	const parts = appId.split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		throw new Error("Invalid application command");
	}
	const args = targetPath === null ? parts.slice(1) : [...parts.slice(1), targetPath];
	// 失败就照实报错，不回退到 xdg-open：用户点了 Zed，结果悄悄用别的程序打开，
	// 比明确告诉他没打开更让人困惑。
	await execFileAsync(parts[0], args, { timeout: 5000 });
}
