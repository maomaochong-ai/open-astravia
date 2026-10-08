/**
 * 官网下载入口的平台 / 架构解析（纯函数，便于直接单元测试）。
 *
 * macOS 的 UA 字符串被浏览器冻结成 `Macintosh; Intel Mac OS X`，Apple Silicon
 * 机器同样如此，所以不能据此判成 x64；可用的真实信号只有 Chromium 的 UA-CH
 * 架构提示。拿不到提示（Safari / Firefox）时按装机量多数派默认 Apple 芯片，
 * 同时把 Intel 版留在「其他版本」里明确标注，并在版本标签上指路。
 */

export type DownloadOs = "macos" | "windows" | "linux";

export type DownloadArchitecture = "arm64" | "x64" | "unknown";

export interface DownloadSignals {
	/** navigator.userAgent */
	readonly userAgent: string;
	/** UA-CH `architecture` 提示（Chromium 提供，形如 "arm" / "x86"），拿不到则为 undefined。 */
	readonly architectureHint?: string | undefined;
}

export interface DownloadTargetOptions {
	readonly version: string;
	/** 产物根地址，默认按版本推导。 */
	readonly base?: string;
	/** 架构未知时是否在版本标签里指路 Intel 版，默认 true。 */
	readonly intelHint?: boolean;
}

export interface DownloadTarget {
	readonly os: DownloadOs;
	readonly architecture: DownloadArchitecture;
	readonly href: string;
	/** 主按钮文案，沿用全站大写英文风格。 */
	readonly label: string;
	/** 主按钮下方的版本标签。 */
	readonly versionLabel: string;
}

const ARM_TOKEN = /arm64|aarch64|armv8|(?:^|[^a-z])arm(?:$|[^a-z])/i;
const X86_TOKEN = /x86|i[3-6]86|amd64|x64|intel/i;

export function resolveDownloadOs(userAgent: string): DownloadOs {
	const isMobileApple = /iPhone|iPad|iPod/i.test(userAgent);
	if (/Mac/i.test(userAgent) && !isMobileApple) return "macos";
	if (/Win/i.test(userAgent)) return "windows";
	return "linux";
}

export function resolveMacArchitecture(signals: DownloadSignals): DownloadArchitecture {
	const hint = signals.architectureHint?.trim();
	if (hint) {
		if (ARM_TOKEN.test(hint)) return "arm64";
		if (X86_TOKEN.test(hint)) return "x64";
	}
	// UA 兜底只认 ARM 字样："Intel Mac OS X" 在两种芯片上都会出现，不能当作 x64。
	return ARM_TOKEN.test(signals.userAgent) ? "arm64" : "unknown";
}

export function resolveDownloadTarget(
	signals: DownloadSignals,
	{ version, base = `https://dl.astravia.dev/app/v${version}`, intelHint = true }: DownloadTargetOptions,
): DownloadTarget {
	const os = resolveDownloadOs(signals.userAgent);

	if (os === "windows") {
		return {
			os,
			architecture: "x64",
			href: `${base}/Astravia-${version}-win-x64.exe`,
			label: "WINDOWS X64",
			versionLabel: `v${version} · EXE`,
		};
	}

	if (os === "linux") {
		return {
			os,
			architecture: "x64",
			href: `${base}/Astravia-${version}.AppImage`,
			label: "LINUX X64",
			versionLabel: `v${version} · AppImage`,
		};
	}

	const architecture = resolveMacArchitecture(signals);
	if (architecture === "x64") {
		return {
			os,
			architecture,
			href: `${base}/Astravia-${version}.dmg`,
			label: "MAC X64 (INTEL)",
			versionLabel: `v${version} · DMG`,
		};
	}

	return {
		os,
		architecture,
		href: `${base}/Astravia-${version}-arm64.dmg`,
		label: "MAC ARM64 (APPLE SILICON)",
		versionLabel:
			architecture === "unknown" && intelHint ? `v${version} · DMG · Intel 芯片请选「其他版本」` : `v${version} · DMG`,
	};
}
