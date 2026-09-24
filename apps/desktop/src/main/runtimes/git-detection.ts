import { posix, win32 } from "node:path";
import type { GitInstallGuide } from "./types.js";

export interface CommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

/** 探测所需的宿主能力，测试时替换为假实现。 */
export interface GitProbeHost {
	platform: NodeJS.Platform;
	pathValue: string;
	exists(path: string): boolean;
	run(command: string, args: readonly string[]): CommandResult;
}

export interface DetectedGit {
	path: string;
	version: string;
}

/** 没装命令行开发者工具时，执行它会弹出系统安装框，探测前必须先确认工具在。 */
const MACOS_GIT_SHIM = "/usr/bin/git";

function pathApiFor(platform: NodeJS.Platform): typeof posix {
	return platform === "win32" ? win32 : posix;
}

function normalizeDir(dir: string, platform: NodeJS.Platform): string {
	const resolved = pathApiFor(platform).resolve(dir.replace(/^"(.*)"$/, "$1"));
	return platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** 按 PATH 顺序找到 shell 里 `git` 会命中的那个文件，跳过 excludeDirs。 */
export function findGitOnPath(host: GitProbeHost, excludeDirs: readonly string[] = []): string | undefined {
	const pathApi = pathApiFor(host.platform);
	// Windows 只认 git.exe：Git for Windows、MinGit、scoop、choco 都提供它，而 .cmd
	// 入口没法不经 shell 直接执行来取版本。
	const name = host.platform === "win32" ? "git.exe" : "git";
	const excluded = new Set(excludeDirs.map((dir) => normalizeDir(dir, host.platform)));
	for (const raw of host.pathValue.split(pathApi.delimiter)) {
		const dir = raw.replace(/^"(.*)"$/, "$1");
		if (!dir || excluded.has(normalizeDir(dir, host.platform))) continue;
		const candidate = pathApi.join(dir, name);
		if (host.exists(candidate)) return candidate;
	}
	return undefined;
}

function macCommandLineToolsInstalled(host: GitProbeHost): boolean {
	const res = host.run("xcode-select", ["-p"]);
	const developerDir = res.status === 0 ? res.stdout.trim() : "";
	return developerDir.length > 0 && host.exists(posix.join(developerDir, "usr", "bin", "git"));
}

/** `git version 2.39.5 (Apple Git-154)` / `git version 2.55.0.windows.5` → `2.39.5` / `2.55.0`。 */
export function parseGitVersion(output: string): string | undefined {
	return output.match(/git version (\d+(?:\.\d+)+)/)?.[1];
}

/** 探测系统 git；PATH 上第一个 git 不可用时视为没有，因为 shell 同样会命中它。 */
export function detectSystemGit(host: GitProbeHost, excludeDirs: readonly string[] = []): DetectedGit | undefined {
	const path = findGitOnPath(host, excludeDirs);
	if (!path) return undefined;
	if (host.platform === "darwin" && path === MACOS_GIT_SHIM && !macCommandLineToolsInstalled(host)) {
		return undefined;
	}
	const res = host.run(path, ["--version"]);
	if (res.status !== 0) return undefined;
	const version = parseGitVersion(`${res.stdout}${res.stderr}`);
	return version ? { path, version } : undefined;
}

const LINUX_INSTALL_COMMANDS: ReadonlyArray<{ ids: readonly string[]; command: string }> = [
	{ ids: ["debian", "ubuntu"], command: "sudo apt install git" },
	{ ids: ["fedora", "rhel", "centos"], command: "sudo dnf install git" },
	{ ids: ["arch"], command: "sudo pacman -S git" },
	{ ids: ["suse", "opensuse"], command: "sudo zypper install git" },
	{ ids: ["alpine"], command: "sudo apk add git" },
];

/** 从 /etc/os-release 的 ID 与 ID_LIKE 推出安装命令，识别不出返回 null。 */
export function linuxGitInstallCommand(osRelease: string): string | null {
	const fields = new Map<string, string>();
	for (const line of osRelease.split(/\r?\n/)) {
		const match = line.match(/^([A-Z_]+)=(.*)$/);
		if (match) fields.set(match[1], match[2].trim().replace(/^["']|["']$/g, ""));
	}
	const ids = [fields.get("ID"), ...(fields.get("ID_LIKE") ?? "").split(/\s+/)]
		.filter((id): id is string => Boolean(id))
		.map((id) => id.toLowerCase());
	for (const id of ids) {
		const hit = LINUX_INSTALL_COMMANDS.find((entry) => entry.ids.includes(id));
		if (hit) return hit.command;
	}
	return null;
}

export interface GitInstallGuideInput {
	platform: NodeJS.Platform;
	/** 当前平台有托管 MinGit 时的版本。 */
	managedVersion?: string;
	readOsRelease(): string | undefined;
}

export function gitInstallGuide(input: GitInstallGuideInput): GitInstallGuide {
	if (input.platform === "darwin") return { kind: "xcode-clt" };
	if (input.platform === "win32") {
		return input.managedVersion ? { kind: "managed-download", version: input.managedVersion } : { kind: "manual" };
	}
	if (input.platform === "linux") {
		const osRelease = input.readOsRelease();
		return { kind: "package-manager", command: osRelease ? linuxGitInstallCommand(osRelease) : null };
	}
	return { kind: "manual" };
}
