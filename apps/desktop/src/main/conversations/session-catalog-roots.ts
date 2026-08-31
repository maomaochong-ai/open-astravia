import { join } from "node:path";
import { codingAgentSessionShardPath } from "@vetta/coding-agent/bootstrap";
import type { RuntimeConversationSessionRoot } from "@vetta/runtime-node/conversation";
import {
	DEFAULT_CONVERSATION_CWD,
	DEFAULT_CONVERSATION_SESSION_DIR,
	DEFAULT_IM_CONVERSATION_CWD,
	DEFAULT_IM_CONVERSATION_SESSION_DIR,
	KB_PROCESSING_CWD,
	KB_PROCESSING_SESSION_DIR,
	readConfigSync,
} from "../config/desktop-config-store.js";

export function resolveDesktopRuntimeSessionRoots(): RuntimeConversationSessionRoot[] {
	const config = readConfigSync();
	// 每个项目认两个会话目录：
	// 1. 全局分片目录——新会话的落点（见 backend-pool 的 resolveRuntimeScope）；
	// 2. `<项目>/.vetta/sessions`——存量兼容。会话曾短暂落在这里，直接摘掉会让用户
	//    这段时间的历史从列表里消失。catalog 在未指定 sessionDir 时并集同一 cwd 的
	//    全部 root，所以两处能同时列出来，不需要迁移文件。
	const projectRoots = [...config.projects, ...config.archivedProjects].flatMap(({ path }) => [
		{ cwd: path, sessionDir: codingAgentSessionShardPath(path) },
		{ cwd: path, sessionDir: join(path, ".vetta", "sessions") },
	]);
	return [
		{
			cwd: DEFAULT_CONVERSATION_CWD,
			sessionDir: DEFAULT_CONVERSATION_SESSION_DIR,
		},
		{
			cwd: DEFAULT_IM_CONVERSATION_CWD,
			sessionDir: DEFAULT_IM_CONVERSATION_SESSION_DIR,
		},
		{
			cwd: KB_PROCESSING_CWD,
			sessionDir: KB_PROCESSING_SESSION_DIR,
		},
		...projectRoots,
	];
}
