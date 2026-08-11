import { openSessionFnRef } from "@shared/store/atoms";
import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";

/**
 * 后台会话编排（仅官方来源插件可用）。
 *
 * 会话本体跑在主进程：`create` + `prompt` 之后，即使宿主停留在别的页面、甚至这个
 * 插件的 UI 没挂载，agent loop 也会继续跑到自然停止点。因此系统插件可以据此做
 * 「多任务并发派单」类工作台（看板等），而不必把每个任务都变成一个前台会话。
 *
 * 与 `ctx.conversation.*` 的分工：那套 API 作用于**用户当前正在看的**会话；
 * 这套 API 按 sessionId 显式寻址，与当前路由无关。
 */
export function createOfficialSessionsApi(capabilitySessionId: string): PluginOfficialApi["sessions"] {
	const invoke = <T>(run: () => T | Promise<T>): Promise<T> =>
		Promise.resolve(pluginRendererCapabilityHost.invokeOfficial(capabilitySessionId, run));

	/** 模型是可选项：空串 / 非字符串一律当「跟随宿主默认」，不报错也不写设置。 */
	const normalizeModelKey = (value: unknown): string | undefined => {
		if (typeof value !== "string") return undefined;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	};

	const assertNonEmpty = (value: unknown, field: string): string => {
		if (typeof value !== "string" || value.trim().length === 0) {
			throw new Error(`official.sessions: ${field} is required`);
		}
		return value;
	};

	return {
		create: (input) =>
			invoke(async () => {
				const cwd = assertNonEmpty(input?.cwd, "cwd");
				// kind "conversation" 走与用户新建会话相同的路径：挂通知订阅、进会话列表，
				// 这样看板派出去的任务在侧边栏里和手动开的会话长得一样、可被正常接管。
				const created = await window.vetta.session.create({ cwd }, "conversation");
				const title = typeof input?.title === "string" ? input.title.trim() : "";
				if (title) {
					await window.vetta.session.rename(created.sessionPath, title).catch((error: unknown) => {
						console.warn("[official.sessions] rename after create failed", error);
					});
				}
				const modelKey = normalizeModelKey(input?.modelKey);
				if (modelKey) {
					// 写会话设置而非只钉单轮：用户之后在对话页手动接着聊，也应该还是这个模型。
					await window.vetta.session.updateSettings(created.sessionId, { modelKey });
				}
				return created;
			}),
		prompt: (sessionId, text, options) =>
			invoke(async () => {
				assertNonEmpty(sessionId, "sessionId");
				assertNonEmpty(text, "text");
				const modelKey = normalizeModelKey(options?.modelKey);
				const outcome = await window.vetta.session.prompt(sessionId, {
					text,
					...(modelKey ? { modelKey } : {}),
				});
				// streaming 中的发送进 kernel 队列（ADR-0060）；把回执如实透出，
				// 调用方据此区分「已发出」与「排队中」，不要当成已开始执行。
				return { status: outcome?.status === "queued" ? "queued" : "sent" };
			}),
		abort: (sessionId) =>
			invoke(async () => {
				assertNonEmpty(sessionId, "sessionId");
				await window.vetta.session.abort(sessionId);
			}),
		rename: (sessionPath, name) =>
			invoke(async () => {
				assertNonEmpty(sessionPath, "sessionPath");
				assertNonEmpty(name, "name");
				await window.vetta.session.rename(sessionPath, name);
			}),
		list: (cwd) =>
			invoke(async () => {
				assertNonEmpty(cwd, "cwd");
				const sessions = await window.vetta.session.listSessions(cwd);
				return sessions.map((session) => ({
					path: session.path,
					cwd: session.cwd,
					firstMessage: session.firstMessage,
					modifiedAt: session.modifiedAt,
				}));
			}),
		listRunning: () => invoke(() => window.vetta.session.listRunning()),
		onRunningChanged: (handler) => {
			// 订阅本身是同步注册（返回取消函数），仍需先过官方校验，避免非官方插件拿到广播。
			pluginRendererCapabilityHost.assertOfficialSession(capabilitySessionId);
			return window.vetta.session.onRunningChanged((payload) => {
				handler({
					sessionPath: payload.sessionPath,
					running: payload.running,
					...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
				});
			});
		},
		open: (input) =>
			invoke(async () => {
				const cwd = assertNonEmpty(input?.cwd, "cwd");
				const sessionPath = assertNonEmpty(input?.sessionPath, "sessionPath");
				const openSession = openSessionFnRef.current;
				if (!openSession) {
					throw new Error("official.sessions.open: host session manager is not ready yet");
				}
				await openSession(cwd, sessionPath);
			}),
	};
}
