import { describe, expect, it } from "vitest";
import {
	type CommandResult,
	detectSystemGit,
	type GitProbeHost,
	gitInstallGuide,
	linuxGitInstallCommand,
	parseGitVersion,
} from "./git-detection.js";

function host(options: {
	platform: NodeJS.Platform;
	pathValue: string;
	files: string[];
	commands?: Record<string, CommandResult>;
}): GitProbeHost & { calls: string[] } {
	const calls: string[] = [];
	return {
		platform: options.platform,
		pathValue: options.pathValue,
		calls,
		exists: (path) => options.files.includes(path),
		run: (command, args) => {
			const key = [command, ...args].join(" ");
			calls.push(key);
			return options.commands?.[key] ?? { status: 1, stdout: "", stderr: "not found" };
		},
	};
}

const ok = (stdout: string): CommandResult => ({ status: 0, stdout, stderr: "" });

describe("detectSystemGit", () => {
	it("returns the first git on PATH with its version", () => {
		const probe = host({
			platform: "linux",
			pathValue: "/usr/local/bin:/usr/bin",
			files: ["/usr/bin/git"],
			commands: { "/usr/bin/git --version": ok("git version 2.43.0\n") },
		});
		expect(detectSystemGit(probe)).toEqual({ path: "/usr/bin/git", version: "2.43.0" });
	});

	it("never runs the macOS /usr/bin/git shim when Command Line Tools are missing", () => {
		const probe = host({
			platform: "darwin",
			pathValue: "/usr/bin:/bin:/opt/homebrew/bin",
			files: ["/usr/bin/git", "/opt/homebrew/bin/git"],
			commands: { "xcode-select -p": { status: 2, stdout: "", stderr: "unable to get active developer directory" } },
		});
		// shell 同样会先命中 /usr/bin/git，所以后面的 homebrew git 不算数。
		expect(detectSystemGit(probe)).toBeUndefined();
		expect(probe.calls).toEqual(["xcode-select -p"]);
	});

	it("uses the macOS shim once the developer directory actually contains git", () => {
		const probe = host({
			platform: "darwin",
			pathValue: "/usr/bin",
			files: ["/usr/bin/git", "/Library/Developer/CommandLineTools/usr/bin/git"],
			commands: {
				"xcode-select -p": ok("/Library/Developer/CommandLineTools\n"),
				"/usr/bin/git --version": ok("git version 2.39.5 (Apple Git-154)\n"),
			},
		});
		expect(detectSystemGit(probe)).toEqual({ path: "/usr/bin/git", version: "2.39.5" });
	});

	it("treats a stale developer directory as missing tools", () => {
		const probe = host({
			platform: "darwin",
			pathValue: "/usr/bin",
			files: ["/usr/bin/git"],
			commands: { "xcode-select -p": ok("/Applications/Xcode.app/Contents/Developer\n") },
		});
		expect(detectSystemGit(probe)).toBeUndefined();
	});

	it("skips excluded directories so the managed copy is not reported as system git", () => {
		const probe = host({
			platform: "win32",
			pathValue: "C:\\Windows\\System32;C:\\Users\\me\\.vetta\\runtimes\\git\\2.55.0.5\\cmd",
			files: ["C:\\Users\\me\\.vetta\\runtimes\\git\\2.55.0.5\\cmd\\git.exe"],
		});
		expect(detectSystemGit(probe, ["c:\\users\\me\\.vetta\\runtimes\\git\\2.55.0.5\\cmd\\"])).toBeUndefined();
	});

	it("finds Git for Windows through a quoted PATH entry", () => {
		const probe = host({
			platform: "win32",
			pathValue: 'C:\\Windows;"C:\\Program Files\\Git\\cmd"',
			files: ["C:\\Program Files\\Git\\cmd\\git.exe"],
			commands: { "C:\\Program Files\\Git\\cmd\\git.exe --version": ok("git version 2.55.0.windows.5\n") },
		});
		expect(detectSystemGit(probe)).toEqual({ path: "C:\\Program Files\\Git\\cmd\\git.exe", version: "2.55.0" });
	});

	it("reports nothing when git exists but fails to run", () => {
		const probe = host({ platform: "linux", pathValue: "/usr/bin", files: ["/usr/bin/git"] });
		expect(detectSystemGit(probe)).toBeUndefined();
	});
});

describe("parseGitVersion", () => {
	it("keeps only the numeric version", () => {
		expect(parseGitVersion("git version 2.55.0.windows.5")).toBe("2.55.0");
		expect(parseGitVersion("bash: git: command not found")).toBeUndefined();
	});
});

describe("linuxGitInstallCommand", () => {
	it.each([
		["ID=ubuntu\nID_LIKE=debian", "sudo apt install git"],
		['ID="linuxmint"\nID_LIKE="ubuntu debian"', "sudo apt install git"],
		["ID=fedora", "sudo dnf install git"],
		['ID="rocky"\nID_LIKE="rhel centos fedora"', "sudo dnf install git"],
		["ID=manjaro\nID_LIKE=arch", "sudo pacman -S git"],
		['ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"', "sudo zypper install git"],
		["ID=alpine", "sudo apk add git"],
	])("maps %j to its package manager", (osRelease, command) => {
		expect(linuxGitInstallCommand(osRelease)).toBe(command);
	});

	it("returns null for an unknown distribution", () => {
		expect(linuxGitInstallCommand("ID=nixos")).toBeNull();
	});
});

describe("gitInstallGuide", () => {
	const noOsRelease = () => undefined;

	it("guides each platform to its own installer", () => {
		expect(gitInstallGuide({ platform: "darwin", readOsRelease: noOsRelease })).toEqual({ kind: "xcode-clt" });
		expect(gitInstallGuide({ platform: "win32", managedVersion: "2.55.0.5", readOsRelease: noOsRelease })).toEqual({
			kind: "managed-download",
			version: "2.55.0.5",
		});
		expect(gitInstallGuide({ platform: "win32", readOsRelease: noOsRelease })).toEqual({ kind: "manual" });
		expect(gitInstallGuide({ platform: "linux", readOsRelease: () => "ID=debian" })).toEqual({
			kind: "package-manager",
			command: "sudo apt install git",
		});
		expect(gitInstallGuide({ platform: "linux", readOsRelease: noOsRelease })).toEqual({
			kind: "package-manager",
			command: null,
		});
	});
});
