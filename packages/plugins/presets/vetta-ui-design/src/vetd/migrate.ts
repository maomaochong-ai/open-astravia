import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { legacySidecarDirOf, manifestPathOf, sniffVetdKind } from "./manifest-types";

/**
 * 把 v1 工作态（`x.vetd` manifest 文件 + `x.vetd.d/` 旁挂目录）就地升级成 v2
 * 设计包（`x.vetd/` 目录，manifest 落在里面的 design.json）。见 ADR-0066。
 *
 * 步骤顺序保证任何一步中断都不丢内容，且重跑幂等：
 * 1. manifest 先复制进旁挂目录（此时两份都在，删谁都不致命）；
 * 2. 删掉旧 manifest 文件（腾出 `x.vetd` 这个名字）；
 * 3. 旁挂目录改名占位。
 *
 * 返回是否真的迁移了。打包分享文件（zip）同样叫 `.vetd`，这里靠内容嗅探放过它。
 */
export async function migrateLegacyDesign(fs: PluginFsApi, vetdPath: string): Promise<boolean> {
	const legacyDir = legacySidecarDirOf(vetdPath);
	const hasLegacyDir = (await fs.stat(legacyDir)) !== null;
	const exists = (await fs.stat(vetdPath)) !== null;
	// 目录读不成文件（EISDIR），所以 readFile 被拒即说明 `x.vetd` 已经是设计包。
	// 注意宿主对**不存在**的路径返回空串而不是抛错，所以先看 exists 再解释内容。
	const manifestJson = await fs.readFile(vetdPath).then(
		(result) => result.content,
		() => null,
	);
	if (manifestJson === null) return false;

	if (!exists) {
		// 上一次迁移停在第 2 步与第 3 步之间：manifest 已经在旁挂目录里，接着改名即可。
		if (!hasLegacyDir) return false;
		await fs.rename(legacyDir, vetdPath);
		return true;
	}
	if (sniffVetdKind(manifestJson.slice(0, 64)) !== "working") return false;

	if (!hasLegacyDir) {
		// 旁挂目录早被删了（只剩一份没有任何源码的设计）：manifest 自己要占住
		// `x.vetd` 这个名字，而同一路径不能既是文件又是目录。先改名挪开再建目录，
		// 全程只用 rename，不存在「删了还没写」的丢失窗口。
		const staging = `${vetdPath}.migrating`;
		await fs.rename(vetdPath, staging);
		await fs.createDirectory(vetdPath);
		await fs.rename(staging, manifestPathOf(vetdPath));
		return true;
	}

	await fs.writeFile(manifestPathOf(legacyDir), manifestJson);
	await fs.delete(vetdPath);
	await fs.rename(legacyDir, vetdPath);
	return true;
}
