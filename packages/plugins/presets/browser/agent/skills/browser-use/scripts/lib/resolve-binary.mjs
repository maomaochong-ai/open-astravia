import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { managedNpmGlobalBinDir } from "./paths.mjs";

/**
 * 定位 agent-browser 的**原生可执行文件**。
 *
 * 为什么不能直接 spawn `"agent-browser"`：
 * - Windows 上 npm 全局装出来的是 `agent-browser.cmd` / `.ps1` 两个 shim，没有无扩展名文件。
 *   Node 出于安全不再允许无 shell 地 spawn `.cmd`，而开 shell 会把参数拼接暴露给命令行解析。
 *   agent-browser 的 postinstall 会把 `.cmd` 改写成直接调用
 *   `node_modules\agent-browser\bin\agent-browser-win32-<arch>.exe`，我们直接找那个 exe。
 * - Unix 上 postinstall 会把 npm 的 symlink 直接指到原生二进制，无扩展名文件即可执行。
 *
 * 搜索顺序把**宿主托管 npm 前缀放在 PATH 之前**：用户机器上很可能已经有一个自己装的
 * agent-browser（nvm / brew 全局），版本未必满足插件要求。宿主 `applyEnv()` 虽然也把托管
 * 前缀前置进了 PATH，但那是宿主的内部约定；在这里显式优先，插件装的那一份就一定赢，
 * 与 PATH 怎么排无关。
 *
 * 所有依赖注入，便于用假 PATH / 假 fs 做单测。
 */

/** Windows ARM64 没有原生构建，npm 包用 x64 走系统模拟。 */
export function binaryFileName(platform, arch) {
	if (platform === "win32") {
		const effective = arch === "arm64" ? "x64" : arch;
		return `agent-browser-win32-${effective}.exe`;
	}
	return `agent-browser-${platform}-${arch}`;
}

/**
 * @param {{ pathValue?: string; platform: string; arch: string; exists?: (p: string) => boolean; preferredDirs?: string[] }} options
 * @returns {string | null} 可执行文件绝对路径；未安装时 null
 */
export function resolveAgentBrowserBinary(options) {
	const exists = options.exists ?? existsSync;
	const fromPath = (options.pathValue ?? "").split(delimiter).filter((entry) => entry.length > 0);
	const entries = [...(options.preferredDirs ?? []), ...fromPath];
	const nativeName = binaryFileName(options.platform, options.arch);

	for (const entry of entries) {
		if (options.platform === "win32") {
			// npm 全局 bin 在 prefix 根，包体在 <prefix>\node_modules\agent-browser\bin\。
			const nativeInPackage = join(entry, "node_modules", "agent-browser", "bin", nativeName);
			if (exists(nativeInPackage)) return nativeInPackage;
			const exe = join(entry, "agent-browser.exe");
			if (exists(exe)) return exe;
			continue;
		}
		const direct = join(entry, "agent-browser");
		if (exists(direct)) return direct;
		// symlink 优化失败时（权限问题）npm 留下的是指向 JS wrapper 的链接，仍然可执行，
		// 所以上面的 direct 命中即可；这里再兜一层包内原生文件，覆盖 prefix/lib 布局。
		const nativeInPackage = join(entry, "..", "lib", "node_modules", "agent-browser", "bin", nativeName);
		if (exists(nativeInPackage)) return nativeInPackage;
	}
	return null;
}

/** wrapper 实际使用的解析入口：托管前缀优先，再走 PATH。 */
export function resolveInstalledAgentBrowser(env = process.env) {
	return resolveAgentBrowserBinary({
		pathValue: env.PATH ?? env.Path,
		platform: process.platform,
		arch: process.arch,
		preferredDirs: [managedNpmGlobalBinDir(env)],
	});
}
