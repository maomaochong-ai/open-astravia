import { describe, expect, it } from "vitest";
import { type ChatRoutePendingState, shouldShowChatRoutePending } from "./chat-route-pending";

const startupState: ChatRoutePendingState = {
	hasActiveSession: false,
	hasDefaultConversation: true,
	hasPendingSessionCreation: false,
	hasPendingSessionOpen: false,
	isChatRoute: true,
	sessionRestoreComplete: true,
};

describe("shouldShowChatRoutePending", () => {
	it("无活动会话时保留启动恢复骨架", () => {
		expect(shouldShowChatRoutePending(startupState)).toBe(true);
	});

	it.each([
		["已有会话打开", { hasPendingSessionOpen: true }],
		["新会话创建", { hasPendingSessionCreation: true }],
		["活动会话", { hasActiveSession: true }],
	] as const)("%s 期间保持 ChatView outlet 挂载", (_label, overrides) => {
		expect(shouldShowChatRoutePending({ ...startupState, ...overrides })).toBe(false);
	});

	it("非聊天路由不显示聊天恢复骨架", () => {
		expect(shouldShowChatRoutePending({ ...startupState, isChatRoute: false })).toBe(false);
	});
});
