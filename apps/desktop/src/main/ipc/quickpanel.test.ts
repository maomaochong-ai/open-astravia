import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerQuickPanelIpc } from "./quickpanel.js";

const ipc = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
const mocks = vi.hoisted(() => ({
	listSessions: vi.fn(async (): Promise<unknown[]> => []),
	filterUserSessions: vi.fn(async (sessions: unknown[]): Promise<unknown[]> => sessions),
	getOwner: vi.fn(async (): Promise<unknown> => undefined),
	ensureOwnership: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler),
		removeHandler: vi.fn(),
	},
}));
vi.mock("../conversations/conversation-ownership-catalog.js", () => ({
	conversationOwnershipCatalog: { filterUserSessions: mocks.filterUserSessions, getOwner: mocks.getOwner },
}));
vi.mock("../agent-teams/team-ownership-backfill.js", () => ({
	ensureLegacyAgentTeamOwnershipCatalog: mocks.ensureOwnership,
}));
vi.mock("../runtime.js", () => ({ getSharedRuntime: () => ({ listSessions: mocks.listSessions }) }));
vi.mock("../shortcuts/shortcut-service.js", () => ({
	getDesktopShortcutService: () => ({ getQuickPanelSettings: vi.fn() }),
	syncQuickPanelTrigger: vi.fn(),
}));
vi.mock("../notifications/notification-service.js", () => ({
	NOTIFICATION_NAVIGATE_CHANNEL: "notification:navigate",
}));
vi.mock("../quickpanel-trigger.js", () => ({ stopQuickPanelTrigger: vi.fn() }));
vi.mock("../quickpanel-window.js", () => ({ hideQuickPanelWindow: vi.fn() }));
vi.mock("../window-manager.js", () => ({ getMainWindow: vi.fn(), showMainWindow: vi.fn() }));
vi.mock("./fs.js", () => ({
	DEFAULT_CONVERSATION_CWD: "C:/default",
	DEFAULT_CONVERSATION_SESSION_DIR: "C:/sessions",
}));

describe("Quick Panel conversation ownership", () => {
	beforeEach(() => {
		ipc.handlers.clear();
		vi.clearAllMocks();
		mocks.getOwner.mockResolvedValue(undefined);
	});

	it("lists only ordinary Conversations after applying the ownership catalog", async () => {
		const ordinary = {
			id: "ordinary",
			path: "C:/sessions/ordinary.jsonl",
			cwd: "C:/workspace",
			name: "Ordinary",
			firstMessage: "hello",
			lastMessagePreview: "world",
			modifiedAt: 2,
		};
		const owned = { ...ordinary, id: "team-member", path: "C:/sessions/team-member.jsonl" };
		mocks.listSessions.mockResolvedValue([owned, ordinary]);
		mocks.filterUserSessions.mockResolvedValue([ordinary]);
		registerQuickPanelIpc();
		const listRecent = ipc.handlers.get("vetta:quickpanel:list-recent");
		if (!listRecent) throw new Error("list-recent handler was not registered");

		await expect(listRecent({}, 8)).resolves.toEqual([
			{
				sessionPath: ordinary.path,
				cwd: ordinary.cwd,
				title: ordinary.name,
				modifiedAt: ordinary.modifiedAt,
				lastMessagePreview: ordinary.lastMessagePreview,
			},
		]);
		expect(mocks.filterUserSessions).toHaveBeenCalledWith([owned, ordinary]);
		expect(mocks.ensureOwnership).toHaveBeenCalledOnce();
	});

	it("rejects a forged direct-open target owned by Agent Team", async () => {
		mocks.getOwner.mockResolvedValue({ kind: "agent-team" });
		registerQuickPanelIpc();
		const openSession = ipc.handlers.get("vetta:quickpanel:open-session");
		if (!openSession) throw new Error("open-session handler was not registered");

		await expect(openSession({}, { sessionPath: "C:/sessions/team.jsonl", cwd: "C:/workspace" })).rejects.toThrow(
			"Conversation is managed by Agent Team",
		);
	});
});
