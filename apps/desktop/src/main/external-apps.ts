import { execFile, spawn } from "node:child_process";
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
		/(visual studio code|vs ?code|vscodium|cursor|trae|qoder|codebuddy|sublime|zed|windsurf|nova|xcode|webstorm|intellij|pycharm|goland|phpstorm|rider|datagrip|rubymine|android studio|fleet|emacs|neovim|vim|textmate|bbedit|gedit|kate)/.test(
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
	return resolved
		.filter((entry): entry is { candidate: KnownApplication; path: string } => entry.path !== null)
		.map(({ candidate, path }) => ({
			id: path,
			name: candidate.name,
			applicationPath: path,
			kind: candidate.kind,
			isDefault: false,
		}));
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

function windowsCandidates(): KnownApplication[] {
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
			name: "Trae",
			kind: "editor",
			paths: [join(programs("Trae"), "Trae.exe"), join(programs("Trae CN"), "Trae CN.exe")],
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
 * 通过 reg query 枚举 HKCR\Directory\shell 下的子键，每个子键通常对应一个
 * 「在此处打开」的应用。提取 command 默认值中的可执行文件路径作为 appId。
 */
async function listApplicationsWindows(_targetPath: string): Promise<ExternalApplication[]> {
	try {
		const { stdout } = await execFileAsync("reg", ["query", "HKCR\\Directory\\shell", "/s"], { timeout: 5000 });

		const apps: ExternalApplication[] = [];
		const lines = stdout.split(/\r?\n/);
		let currentName = "";
		for (const line of lines) {
			const subKeyMatch = line.match(/^HKEY_CLASSES_ROOT\\Directory\\shell\\([^\\]+)$/);
			if (subKeyMatch) {
				currentName = subKeyMatch[1];
				continue;
			}
			if (currentName && /\\command$/i.test(line)) {
				continue;
			}
			const defaultMatch = line.match(/^\s*\(Default\)\s+REG_SZ\s+(.+)$/i);
			if (defaultMatch && currentName) {
				const raw = defaultMatch[1].trim();
				// 从命令字符串中提取第一个可执行文件路径（带引号或第一个 token）
				const exeMatch = raw.match(/^"([^"]+\.exe)"|^([^\s]+\.exe)/i);
				const exePath = exeMatch ? (exeMatch[1] ?? exeMatch[2]) : raw;
				if (exePath && /\.exe$/i.test(exePath)) {
					const displayName = prettifyWindowsAppName(currentName);
					if (!apps.some((a) => a.applicationPath.toLowerCase() === exePath.toLowerCase())) {
						apps.push({
							id: exePath,
							name: displayName,
							applicationPath: exePath,
							kind: inferApplicationKind(displayName),
							isDefault: false,
						});
					}
				}
				currentName = "";
			}
		}
		return apps;
	} catch {
		return [];
	}
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
