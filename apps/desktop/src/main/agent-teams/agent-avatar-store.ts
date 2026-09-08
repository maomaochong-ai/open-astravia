import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { createLocalFileUrl } from "../../shared/file-protocol.js";

/**
 * 用户上传的头像存放处。刻意放在 Agent Team 配置目录之外：
 * 那个目录的写回逻辑会清理不认识的团队/Agent 子目录，图片放进去迟早被扫掉。
 * 也不能借用 image-cache——那是 7 天过期的临时缓存，头像必须长期有效。
 */
const AVATAR_ROOT = join(getVettaHomePath(), "agent-avatars");

/** 只收浏览器能直接渲染的位图格式；SVG 会把任意脚本带进渲染进程，拒收。 */
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const MAX_BYTES = 5 * 1024 * 1024;

export interface StoredAgentAvatar {
	readonly path: string;
	/** 渲染进程可直接当 `<img src>` 用；file:// 会被 Electron 拦掉，必须走本协议（ADR-0027）。 */
	readonly url: string;
}

/** 把用户选中的图片复制进头像目录，返回落盘路径与可渲染的 URL。 */
export async function storeAgentAvatarFile(sourcePath: string): Promise<StoredAgentAvatar> {
	const extension = extname(sourcePath).toLowerCase();
	if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`Unsupported avatar image type: ${extension || "unknown"}`);
	const info = await stat(sourcePath);
	if (!info.isFile()) throw new Error("Avatar source must be a file");
	if (info.size > MAX_BYTES) throw new Error(`Avatar image is larger than ${MAX_BYTES / (1024 * 1024)} MB`);

	await mkdir(AVATAR_ROOT, { recursive: true });
	// 随机文件名而不是沿用原名：同名覆盖会让还在引用旧图的 Agent 悄悄换脸。
	const target = join(AVATAR_ROOT, `${randomUUID()}${extension}`);
	await copyFile(sourcePath, target);
	return { path: target, url: createLocalFileUrl(target) };
}

export function agentAvatarRoot(): string {
	return AVATAR_ROOT;
}
