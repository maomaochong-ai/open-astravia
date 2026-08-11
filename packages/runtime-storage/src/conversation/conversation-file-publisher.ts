import { randomUUID } from "node:crypto";
import { link, rm, writeFile } from "node:fs/promises";

/** 在目标同目录完整写入临时文件，再以独占硬链接原子发布。 */
export async function publishConversationFileExclusive(targetPath: string, content: string): Promise<void> {
	const temporaryPath = `${targetPath}.${randomUUID()}.publish.tmp`;
	try {
		await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
		await link(temporaryPath, targetPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
