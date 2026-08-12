/**
 * 让版本历史跟着 `.vetdz` 走（ADR-0069）。
 *
 * 打包与还原都必须绕到 node 侧：宿主的递归列举跳过所有 `.` 开头的条目，`.history/`
 * 对导出代码完全不可见；而 git 对象是无扩展名的二进制，插件的 `readFile` 会按 utf8
 * 解坏它们。所以这里只做「让 runner 落一个 zip，我再把这个 zip 搬进/搬出分享包」。
 */
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { runHistoryCommand } from "./runner-host";

/** 分享包里存历史的条目名。老包没有这一项，导入时按「没有历史」处理。 */
export const HISTORY_ENTRY = "history.zip";

/** 中转文件。放在设计包内部（插件 fs 是项目作用域），用完即删。 */
const PACK_FILE = ".history-pack.zip";

/**
 * 单个历史包的体积上限。
 *
 * 32MB 是宿主 `readBinaryFile` 的硬上限；留出余量取 24MB。超了就不带历史——分享包
 * 本身还是完整的设计，收包方只是从「初始状态」重新开始记。
 */
const MAX_PACK_BYTES = 24 * 1024 * 1024;

export type HistoryPack =
	/** 带得走。 */
	| { kind: "ok"; base64: string; bytes: number }
	/** 有历史但太大——调用方要告诉用户这个包为什么不含历史。 */
	| { kind: "too-large"; bytes: number }
	/** 没有历史，或者 runner 不可用。导出照常，不声张。 */
	| { kind: "none" };

/** 打包这份设计的历史。导出不该因为历史而失败，所以任何异常都退化成 `none`。 */
export async function packHistoryForShare(ctx: PluginContext, designDir: string): Promise<HistoryPack> {
	const packPath = `${designDir}/${PACK_FILE}`;
	try {
		const { size } = await runHistoryCommand<{ size: number }>(ctx, {
			cmd: "pack",
			dir: designDir,
			out: packPath,
		});
		if (size === 0) return { kind: "none" };
		if (size > MAX_PACK_BYTES) return { kind: "too-large", bytes: size };
		const binary = await ctx.fs.readBinaryFile(packPath);
		return { kind: "ok", base64: binary.data, bytes: size };
	} catch {
		return { kind: "none" };
	} finally {
		await ctx.fs.delete(packPath).catch(() => {});
	}
}

/** 把分享包里的历史还原进新导入的设计。失败静默——设计本身已经落地了。 */
export async function unpackHistoryFromShare(
	ctx: PluginContext,
	designDir: string,
	base64: string,
): Promise<boolean> {
	const packPath = `${designDir}/${PACK_FILE}`;
	try {
		await ctx.fs.writeFile(packPath, base64, "base64");
		const { files } = await runHistoryCommand<{ files: number }>(ctx, {
			cmd: "unpack",
			dir: designDir,
			from: packPath,
		});
		return files > 0;
	} catch {
		return false;
	} finally {
		await ctx.fs.delete(packPath).catch(() => {});
	}
}
