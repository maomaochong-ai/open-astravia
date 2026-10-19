import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 一个可用于打开某个路径（文件或目录）的外部应用。
 */
export interface ExternalApplication {
	/** 应用的唯一标识：macOS 为 bundle identifier，其它平台为可执行文件路径。 */
	id: string;
	/** 展示给用户的名称。 */
	name: string;
	/** 应用可执行文件或 .app 包的路径。 */
	applicationPath: string;
	/** 是否为系统默认应用。 */
	isDefault: boolean;
}

/**
 * 列出能够打开指定路径的外部应用。
 *
 * - macOS: 通过 osascript 调用 NSWorkspace，返回所有声明能打开该路径的应用。
 * - Windows: 查询注册表 HKCR\Directory\shell 下注册的目录打开方式。
 * - Linux: 解析系统与用户目录下能处理 inode/directory 的 .desktop 文件。
 */
export async function listExternalApplications(targetPath: string): Promise<ExternalApplication[]> {
	if (process.platform === "darwin") {
		return listApplicationsMacOS(targetPath);
	}
	if (process.platform === "win32") {
		return listApplicationsWindows(targetPath);
	}
	return listApplicationsLinux(targetPath);
}

/**
 * 用指定应用打开路径。
 *
 * - macOS: `open -b <bundleId> <path>`（通过 bundle identifier 定位应用）
 * - Windows: `Start-Process <exePath> <path>`（通过 powershell）
 * - Linux: `gtk-launch <desktopId>` 或直接执行 .desktop 中的 Exec
 */
export async function openPathWithApplication(targetPath: string, appId: string): Promise<void> {
	if (process.platform === "darwin") {
		await execFileAsync("open", ["-b", appId, targetPath]);
		return;
	}
	if (process.platform === "win32") {
		// appId 在 Windows 上是可执行文件路径
		await execFileAsync("powershell", [
			"-NoProfile",
			"-Command",
			`Start-Process -FilePath '${escapeSingleQuotes(appId)}' -ArgumentList '${escapeSingleQuotes(targetPath)}'`,
		]);
		return;
	}
	// Linux: appId 是可执行文件路径或 desktop 文件 id
	await openWithLinux(targetPath, appId);
}

function escapeSingleQuotes(s: string): string {
	return s.replace(/'/g, "''");
}

// ─── macOS 实现 ─────────────────────────────────────────────────────

/**
 * 通过 JXA 脚本调用 NSWorkspace，枚举可以打开指定路径的应用。
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
				id: app.identity,
				name: app.name,
				applicationPath: app.applicationPath,
				isDefault: Boolean(app.isDefault),
			}));
	} catch {
		return [];
	}
}

// ─── Windows 实现 ───────────────────────────────────────────────────

/**
 * 通过 reg query 枚举 HKCR\Directory\shell 下的子键，每个子键通常对应一个
 * 「在此处打开」的应用。提取 command 默认值中的可执行文件路径作为 appId。
 * 默认应用通过查询 HKCR\Directory\shell 的默认值判断。
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
		Code: "VS Code",
		vscode: "VS Code",
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

// ─── Linux 实现 ─────────────────────────────────────────────────────

interface DesktopEntry {
	id: string;
	name: string;
	exec: string;
	icon?: string;
	handlesDirectory: boolean;
}

const LINUX_DESKTOP_DIRS = [
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
	for (const dir of LINUX_DESKTOP_DIRS) {
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

async function openWithLinux(targetPath: string, appId: string): Promise<void> {
	// appId 是清理过的 Exec 命令（不含 %f 占位符）；把目标路径作为参数传入
	const parts = appId.split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		throw new Error("Invalid application command");
	}
	try {
		await execFileAsync(parts[0], [...parts.slice(1), targetPath], { timeout: 5000 });
	} catch {
		// 回退到默认程序
		await execFileAsync("xdg-open", [targetPath], { timeout: 5000 });
	}
}
