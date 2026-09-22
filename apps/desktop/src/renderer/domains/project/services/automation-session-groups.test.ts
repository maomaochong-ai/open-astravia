import type { AutomationSessionLink } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import {
	automationGroupContaining,
	collapseAutomationSessions,
	expandAutomationGroupRows,
} from "./automation-session-groups";
import type { SidebarConversationInfo } from "./sidebar-conversation-projection";

function session(path: string, modifiedAt: number): SidebarConversationInfo {
	return { kind: "conversation", id: path, path, cwd: "C:/p", name: path, firstMessage: "", modifiedAt };
}

function link(sessionPath: string, taskId: string, mode: AutomationSessionLink["mode"] = "new-session") {
	return [sessionPath, { sessionPath, taskId, taskName: `Task ${taskId}`, mode }] as const;
}

const toView = (item: SidebarConversationInfo) => ({
	key: `conversation:${item.path}`,
	path: item.path,
	label: item.path,
	active: item.path === "run-1",
	running: false,
});

describe("automation session groups", () => {
	const sessions = [
		session("run-1", 1),
		session("run-3", 3),
		session("manual", 2),
		session("run-2", 5),
		session("bound", 4),
	];
	const links = new Map([
		link("run-1", "daily"),
		link("run-2", "daily"),
		link("run-3", "daily"),
		link("bound", "sync", "same-session"),
	]);

	it("keeps only the latest run of each new-session automation as the ordering placeholder", () => {
		const collapsed = collapseAutomationSessions(sessions, links, new Map());

		expect(collapsed.sessions.map((item) => item.path)).toEqual(["manual", "run-2", "bound"]);
		expect(collapsed.groupsByHeadPath.get("run-2")?.members.map((item) => item.path)).toEqual([
			"run-2",
			"run-3",
			"run-1",
		]);
		expect(automationGroupContaining(collapsed.groupsByHeadPath, "run-1")).toBe("daily");
		expect(automationGroupContaining(collapsed.groupsByHeadPath, "bound")).toBeUndefined();
	});

	it("leaves pinned runs and single-run automations as ordinary rows", () => {
		const collapsed = collapseAutomationSessions(sessions, links, new Map([["run-2", 10]]));

		expect(collapsed.sessions.map((item) => item.path)).toEqual(["run-3", "manual", "run-2", "bound"]);
		expect(collapsed.groupsByHeadPath.get("run-3")?.members).toHaveLength(2);
		expect(
			collapseAutomationSessions([session("solo", 1)], new Map([link("solo", "once")]), new Map()).groupsByHeadPath
				.size,
		).toBe(0);
	});

	it("turns the placeholder into a group header and lists every run beneath it when expanded", () => {
		const { sessions: collapsedSessions, groupsByHeadPath } = collapseAutomationSessions(sessions, links, new Map());
		const placeholders = collapsedSessions.map(toView);

		const collapsedRows = expandAutomationGroupRows(placeholders, groupsByHeadPath, new Set(), toView);
		expect(collapsedRows.map((row) => [row.key, row.label, row.groupCount, row.active])).toEqual([
			["conversation:manual", "manual", undefined, false],
			["automation-group:daily", "Task daily", 3, true],
			["conversation:bound", "bound", undefined, false],
		]);

		const expandedRows = expandAutomationGroupRows(placeholders, groupsByHeadPath, new Set(["daily"]), toView);
		expect(expandedRows.map((row) => [row.key, row.nested ?? false, row.active])).toEqual([
			["conversation:manual", false, false],
			["automation-group:daily", false, false],
			["conversation:run-2", true, false],
			["conversation:run-3", true, false],
			["conversation:run-1", true, true],
			["conversation:bound", false, false],
		]);
	});
});
