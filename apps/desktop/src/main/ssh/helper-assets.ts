import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SshHelperTarget } from "@vetta/ssh-transport";

/**
 * 远端 helper 二进制在本机的位置。
 *
 * 打包后随应用分发在 `Resources/ssh-helper/<os>-<arch>/`；开发态用
 * `apps/ssh-helper` 里 `make cross-build` 的产物。哪个都没有就返回 undefined——helper 是
 * 可选加速，缺了它远程项目照常走 `ssh exec`，不该因此报错。
 */
export function resolveSshHelperBinary(
	target: SshHelperTarget,
	environment: { readonly resourcesPath?: string; readonly cwd: string; readonly override?: string } = {
		resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
		cwd: process.cwd(),
		override: process.env.VETTA_SSH_HELPER_DIR,
	},
): string | undefined {
	const relative = join(`${target.os}-${target.arch}`, "vetta-ssh-helper");
	const candidates = [
		environment.override ? join(environment.override, relative) : undefined,
		environment.resourcesPath ? join(environment.resourcesPath, "ssh-helper", relative) : undefined,
		// dev：主进程的 cwd 是 apps/desktop，也可能是仓库根。
		resolve(environment.cwd, "../ssh-helper/dist", relative),
		resolve(environment.cwd, "apps/ssh-helper/dist", relative),
	];
	return candidates.find((candidate): candidate is string => candidate !== undefined && existsSync(candidate));
}
