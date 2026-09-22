import { describe, expect, it } from "vitest";
import { type LegacyScheduledTask, legacyCronToSchedule, migrateLegacyTask } from "./automation-migration.js";

const NOW = new Date(2026, 0, 20, 12, 0).getTime();

function legacy(overrides: Partial<LegacyScheduledTask> = {}): LegacyScheduledTask {
	return {
		id: "legacy",
		name: "Legacy",
		prompt: "do it",
		cron: "0 9 * * *",
		isOnce: false,
		enabled: true,
		cwd: "C:/home/.vetta/workspace",
		executionMode: "sandbox",
		createdAt: 1,
		updatedAt: 2,
		lastRunAt: 3,
		lastRunStatus: "success",
		...overrides,
	};
}

describe("legacy automation migration", () => {
	it("maps legacy cron expressions onto the new repeat kinds", () => {
		expect(legacyCronToSchedule("15 * * * *", false, NOW)).toEqual({ kind: "hourly", minute: 15 });
		expect(legacyCronToSchedule("0 9 * * *", false, NOW)).toEqual({ kind: "daily", hour: 9, minute: 0 });
		expect(legacyCronToSchedule("0 9 * * 1,2,3,4,5", false, NOW)).toEqual({
			kind: "weekly",
			weekdays: [1, 2, 3, 4, 5],
			hour: 9,
			minute: 0,
		});
		expect(legacyCronToSchedule("30 8 1,15 * *", false, NOW)).toEqual({
			kind: "monthly",
			days: [1, 15],
			hour: 8,
			minute: 30,
		});
		expect(legacyCronToSchedule("0 */2 * * *", false, NOW)).toEqual({ kind: "custom", cron: "0 */2 * * *" });
		expect(legacyCronToSchedule("0 9 25 1 *", true, NOW)).toEqual({
			kind: "once",
			at: new Date(2026, 0, 25, 9, 0).getTime(),
		});
	});

	it("keeps unknown cwd tasks in the conversation and turns the skill into an inline token", () => {
		const migrated = migrateLegacyTask(
			legacy({ skill: { name: "daily report", type: "skill" }, modelKey: "anthropic/opus" }),
			{ conversationCwd: "C:/home/.vetta/conversation", isKnownProject: () => false, now: NOW },
		);
		expect(migrated).toEqual({
			id: "legacy",
			name: "Legacy",
			prompt: '@skill:"daily report" do it',
			schedule: { kind: "daily", hour: 9, minute: 0 },
			runTarget: { mode: "new-session", projectCwd: "C:/home/.vetta/conversation" },
			model: { key: "anthropic/opus" },
			enabled: true,
			createdAt: 1,
			updatedAt: 2,
			lastRunAt: 3,
			lastRunStatus: "success",
		});
	});

	it("targets a known project and disables one-time tasks whose moment already passed", () => {
		const migrated = migrateLegacyTask(legacy({ cwd: "C:/repo", cron: "0 9 1 1 *", isOnce: true }), {
			conversationCwd: "C:/home/.vetta/conversation",
			isKnownProject: (cwd) => cwd === "C:/repo",
			now: NOW,
		});
		expect(migrated.runTarget).toEqual({ mode: "new-session", projectCwd: "C:/repo" });
		expect(migrated.schedule).toEqual({ kind: "once", at: new Date(2027, 0, 1, 9, 0).getTime() });
		expect(migrated.enabled).toBe(true);

		const disabled = migrateLegacyTask(legacy({ cron: "0 9 1 1 *", isOnce: true, enabled: false }), {
			conversationCwd: "C:/home/.vetta/conversation",
			isKnownProject: () => false,
			now: NOW,
		});
		expect(disabled.enabled).toBe(false);
	});
});
