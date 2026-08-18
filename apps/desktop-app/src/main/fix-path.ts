import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { getAppLogger } from "./logger.js";

const log = getAppLogger("fix-path");

// 唯一标记,把 $PATH 从登录 shell 的输出里精确截出来,规避 profile 里的 banner/echo 污染。
const MARKER = "__VETTA_PATH_MARKER__";

/**
 * 修复 macOS/Linux GUI 进程的 PATH。
 *
 * 从 Finder/Dock 启动的 GUI 应用不会继承终端 shell 的 PATH,只拿到系统精简 PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin),不含 homebrew(/opt/homebrew/bin)等用户安装路径。
 * 而 coding-agent 的 bash 工具用的是 `bash -c`(非登录非交互),不会 source 任何
 * profile,也补不回这些路径,导致 brew 及一切 brew 安装的命令找不到。
 *
 * 这里跑一次用户登录交互 shell(`-ilc`,确保 .zprofile/.zshrc/.bash_profile 都被
 * source),解析出真实 PATH,把缺失的项**追加**到 process.env.PATH 末尾。
 *
 * 设计取舍:
 * - 追加而非前置:保留 RuntimeManager.applyEnv() 注入的托管运行时优先级,不让
 *   homebrew 的 node/python 抢在托管版前面。
 * - 不在 runtimes/manager.ts 的 SYSTEM_PATH_SNAPSHOT 之前注入:那份快照专用于
 *   探测「系统运行时」,保持纯净以免改变运行时探测行为。bash 在用户交互时才执行,
 *   此处修复早于它即可。
 *
 * 幂等:重复调用安全(已存在的路径不会重复追加)。失败静默,不影响启动。
 */
export function fixPath(): void {
	// Windows GUI 进程能正常继承系统 PATH,无需修复。
	if (process.platform === "win32") return;

	const shell = process.env.SHELL || "/bin/zsh";
	try {
		const res = spawnSync(shell, ["-ilc", `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`], {
			encoding: "utf-8",
			timeout: 5000,
			// 关掉 stdin,避免交互式 shell 阻塞等待输入。
			stdio: ["ignore", "pipe", "ignore"],
		});
		if (res.status !== 0 || !res.stdout) {
			log.warn("login shell PATH probe failed", { shell, status: res.status });
			return;
		}
		const start = res.stdout.indexOf(MARKER);
		const end = res.stdout.indexOf(MARKER, start + MARKER.length);
		if (start === -1 || end === -1 || end <= start) return;
		const resolved = res.stdout.slice(start + MARKER.length, end).trim();
		if (!resolved) return;

		const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
		const existing = (process.env[pathKey] ?? "").split(delimiter).filter(Boolean);
		const seen = new Set(existing);
		const appended = resolved.split(delimiter).filter((p) => p && !seen.has(p));
		if (appended.length === 0) return;

		process.env[pathKey] = [...existing, ...appended].join(delimiter);
		log.info("PATH fixed from login shell", { shell, added: appended });
	} catch (err) {
		log.warn("fixPath failed", err);
	}
}
