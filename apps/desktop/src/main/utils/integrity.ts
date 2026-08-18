import { createHash } from "node:crypto";

/**
 * 校验下载产物的 sha256。
 *
 * expected 为空表示服务端未提供摘要（存量技能/插件/安装包上传于摘要机制之前），
 * 此时跳过校验而不是拒绝安装，否则老条目会全部装不上。
 *
 * @throws 摘要不匹配时抛出，调用方应中止安装并清理已落盘的临时文件
 */
export function verifySha256(data: Buffer, expected: string | undefined, label: string): void {
	if (!expected) return;

	const actual = createHash("sha256").update(data).digest("hex");
	if (actual !== expected.toLowerCase()) {
		throw new Error(`${label} 校验失败：内容摘要与服务端不一致（期望 ${expected}，实际 ${actual}）`);
	}
}
