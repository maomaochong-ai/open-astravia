import { createHash } from "node:crypto";
import { FS_EDITABLE_TEXT_ERROR } from "../../preload/fs-types.js";
import { decodeUtf8Text } from "./text-content.js";

export const MAX_EDITABLE_TEXT_FILE_SIZE = 2 * 1024 * 1024;

/**
 * 编辑器保存时的乐观并发标记。
 *
 * 本地与远程必须用同一份实现：修订号是「保存前文件有没有被别人动过」的唯一依据，
 * 两边算法一旦不同，远程文件要么永远冲突、要么永远不冲突。
 */
export function getFileRevision(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

export function decodeEditableText(buffer: Buffer): { content: string; hasBom: boolean; lineEnding: "lf" | "crlf" } {
	const decoded = decodeUtf8Text(buffer);
	if (!decoded) throw new Error(FS_EDITABLE_TEXT_ERROR.NOT_UTF8);
	const { content, hasBom } = decoded;
	return {
		content,
		hasBom,
		lineEnding: content.includes("\r\n") ? "crlf" : "lf",
	};
}

/** 按编辑器约定拼回要落盘的字节：保留原有 BOM。 */
export function encodeEditableText(content: string, hasBom: boolean | undefined): Buffer {
	const contentBuffer = Buffer.from(content, "utf8");
	return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), contentBuffer]) : contentBuffer;
}
