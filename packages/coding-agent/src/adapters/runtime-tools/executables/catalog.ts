import { join } from "node:path";
import type { CodingToolExecutable } from "@vetta/runtime-tools/coding";

export interface CodingToolReleaseConfig {
	readonly name: string;
	readonly repository: string;
	readonly binaryName: string;
	readonly tagPrefix: string;
	readonly resolveAssetName: (version: string, platform: string, architecture: string) => string | undefined;
}

const CODING_TOOL_RELEASES: Record<CodingToolExecutable, CodingToolReleaseConfig> = {
	fd: {
		name: "fd",
		repository: "sharkdp/fd",
		binaryName: "fd",
		tagPrefix: "v",
		resolveAssetName: (version, platform, architecture) => {
			if (platform === "darwin") {
				const arch = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${arch}-apple-darwin.tar.gz`;
			}
			if (platform === "linux") {
				const arch = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${arch}-unknown-linux-gnu.tar.gz`;
			}
			if (platform === "win32") {
				const arch = architecture === "arm64" ? "aarch64" : "x86_64";
				return `fd-v${version}-${arch}-pc-windows-msvc.zip`;
			}
			return undefined;
		},
	},
	rg: {
		name: "ripgrep",
		repository: "BurntSushi/ripgrep",
		binaryName: "rg",
		tagPrefix: "",
		resolveAssetName: (version, platform, architecture) => {
			if (platform === "darwin") {
				const arch = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ripgrep-${version}-${arch}-apple-darwin.tar.gz`;
			}
			if (platform === "linux") {
				return architecture === "arm64"
					? `ripgrep-${version}-aarch64-unknown-linux-gnu.tar.gz`
					: `ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz`;
			}
			if (platform === "win32") {
				const arch = architecture === "arm64" ? "aarch64" : "x86_64";
				return `ripgrep-${version}-${arch}-pc-windows-msvc.zip`;
			}
			return undefined;
		},
	},
};

export interface CodingToolDownloadPlanOptions {
	readonly tool: CodingToolExecutable;
	readonly version: string;
	readonly platform: NodeJS.Platform;
	readonly architecture: string;
	readonly toolsDirectory: string;
}

export interface CodingToolDownloadPlan {
	readonly assetName: string;
	readonly archivePath: string;
	readonly binaryFileName: string;
	readonly binaryPath: string;
	readonly downloadUrl: string;
}

export function getCodingToolReleaseConfig(tool: CodingToolExecutable): CodingToolReleaseConfig {
	return CODING_TOOL_RELEASES[tool];
}

export function createCodingToolDownloadPlan(
	options: CodingToolDownloadPlanOptions,
): CodingToolDownloadPlan | undefined {
	const config = getCodingToolReleaseConfig(options.tool);
	const assetName = config.resolveAssetName(options.version, options.platform, options.architecture);
	if (!assetName) return undefined;

	const binaryFileName = `${config.binaryName}${options.platform === "win32" ? ".exe" : ""}`;
	return {
		assetName,
		archivePath: join(options.toolsDirectory, assetName),
		binaryFileName,
		binaryPath: join(options.toolsDirectory, binaryFileName),
		downloadUrl: `https://github.com/${config.repository}/releases/download/${config.tagPrefix}${options.version}/${assetName}`,
	};
}
