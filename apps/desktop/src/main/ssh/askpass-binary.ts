import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Windows 上 SSH_ASKPASS 指向的 Go 编译 askpass.exe 在本机的位置。
 *
 * 打包后随应用分发在 `Resources/askpass/`；开发态用 `apps/ssh-askpass` 里
 * `make cross-build` 的产物。解析不到返回 undefined——Windows 上此时不注入 askpass，
 * 密码认证会失败并带着 ssh 自己的报错（与 macOS 上 askpass 准备失败的行为一致）。
 */
export function resolveAskpassWindowsBinary(
	environment: { readonly resourcesPath?: string; readonly cwd: string; readonly override?: string } = {
		resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
		cwd: process.cwd(),
		override: process.env.ASTRAVIA_SSH_ASKPASS_DIR,
	},
): string | undefined {
	const relative = join("windows-amd64", "astravia-ssh-askpass.exe");
	const candidates = [
		environment.override ? join(environment.override, relative) : undefined,
		environment.resourcesPath ? join(environment.resourcesPath, "askpass", relative) : undefined,
		// dev：主进程的 cwd 是 apps/desktop，也可能是仓库根。
		resolve(environment.cwd, "../ssh-askpass/dist", relative),
		resolve(environment.cwd, "apps/ssh-askpass/dist", relative),
	];
	return candidates.find((candidate): candidate is string => candidate !== undefined && existsSync(candidate));
}
