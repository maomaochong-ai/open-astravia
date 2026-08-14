/**
 * 一份设计的依赖清单：`x.vetd/package.json`（ADR-0068）。
 *
 * 唯一事实源，三个消费方问的是同一件事：
 * - scaffold：新建设计时写出清单，让 `x.vetd/` 从第一秒就是一个可 npm install 的工程。
 * - check-sources：`uninstalled-import` 判据里「这份设计装了什么」的那一半。
 * - engine-manager：打开设计时决定要不要先补装，以及 vetd_install 落到哪个目录。
 *
 * 事实源是**声明**而不是 node_modules：清单在、依赖没装是一个正常且短暂的状态
 * （刚从 .vetdz 导入），由补装接住；反过来 node_modules 里有什么则完全不作数。
 */
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { engineRuntimeDependencies } from "../engine/engine-files";

export const PACKAGE_FILE = "package.json";

/** 依赖装在哪。生成物，不进 .vetdz（见 bundle-paths 的 GENERATED_PREFIXES）。 */
export const MODULES_DIR = "node_modules";

/**
 * 新建设计的依赖清单内容。
 *
 * react 三件套按引擎版本钉死：引擎的 vite alias 最终会把它们短路到引擎那一份，所以
 * 这里写的版本不决定运行时用哪个 react——它决定的是第三方库装进来时 peer 校验看到
 * 什么，以及这个目录被外部工具直接构建时装到什么。两者都要求它与引擎一致。
 */
export function designPackageJson(name: string): string {
	const manifest = {
		name,
		private: true,
		type: "module",
		dependencies: engineRuntimeDependencies(),
	};
	return `${JSON.stringify(manifest, null, "\t")}\n`;
}

/** 声明了哪些依赖（含 react 三件套）。没有清单或内容坏了都返回空表。 */
export async function readDesignDependencies(fs: PluginFsApi, dirPath: string): Promise<string[]> {
	try {
		const { content } = await fs.readFile(`${dirPath}/${PACKAGE_FILE}`);
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== "object" || parsed === null) return [];
		const dependencies = (parsed as { dependencies?: unknown }).dependencies;
		if (typeof dependencies !== "object" || dependencies === null) return [];
		return Object.keys(dependencies as Record<string, unknown>);
	} catch {
		return [];
	}
}

/**
 * 打开这份设计之前要不要先跑一次 npm install。
 *
 * 判据是「声明了依赖，但 node_modules 不在」——这正是从 .vetdz 导入、或者从别人的
 * git 仓库 clone 下来的那一刻。已经装过的设计不重复检查依赖树是否完整：那会把每次
 * 打开都变成一次 npm 往返，而真正装坏了的情况由构建报错暴露，用户可以重新装。
 */
export async function needsDependencyInstall(fs: PluginFsApi, dirPath: string): Promise<boolean> {
	const declared = await readDesignDependencies(fs, dirPath);
	if (declared.length === 0) return false;
	return (await fs.stat(`${dirPath}/${MODULES_DIR}`)) === null;
}
