import type { CodingToolExecutable } from "@astravia/runtime-tools/coding";

interface MissingExecutableGuidance {
	readonly displayName: string;
	readonly installCommands: string;
}

const GUIDANCE: Record<CodingToolExecutable, MissingExecutableGuidance> = {
	fd: {
		displayName: "fd",
		installCommands:
			"macOS `brew install fd` or `cargo install fd-find`; Ubuntu/Debian `sudo apt install fd-find`; Fedora `sudo dnf install fd-find`; Windows `winget install sharkdp.fd`; Android/Termux `pkg install fd`",
	},
	rg: {
		displayName: "ripgrep (rg)",
		installCommands:
			"macOS `brew install ripgrep` or `cargo install ripgrep`; Ubuntu/Debian `sudo apt install ripgrep`; Fedora `sudo dnf install ripgrep`; Windows `winget install BurntSushi.ripgrep.MSVC`; Android/Termux `pkg install ripgrep`",
	},
};

/**
 * fd / rg 缺失且自动下载失败时面向模型的错误文案。
 *
 * 自动下载固定从 GitHub Releases 取（见 managed-executables/catalog.ts），
 * 网络到不了 github.com 时（国内网络常见）必然失败。旧文案只说明
 * "could not be downloaded"，不告诉用户怎么装，四个搜索工具就此不可用
 * 且无从下手；这里保留原句并补上失败原因与各平台手动安装命令。
 */
export function formatMissingCodingToolError(tool: CodingToolExecutable): string {
	const { displayName, installCommands } = GUIDANCE[tool];
	return (
		`${displayName} is not available and could not be downloaded ` +
		`(automatic download from GitHub Releases failed, which usually means github.com is not reachable from this machine). ` +
		`Install it manually and restart Astravia — ${installCommands}.`
	);
}
