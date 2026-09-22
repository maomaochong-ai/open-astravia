import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_SCHEDULER_CAPABILITIES,
	DOMAIN_SCHEDULER_CAPABILITY_CATALOG,
	SCHEDULER_NOT_RUN_REASONS,
	SCHEDULER_RECORD_STATUSES,
	SCHEDULER_RUN_TARGET_MODES,
} from "../../src/domain.js";

describe("scheduler domain capabilities", () => {
	it("uses one stable id per scheduler operation", () => {
		expect(Object.values(DOMAIN_SCHEDULER_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.history.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.create`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.update`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.delete`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.set-enabled`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.run`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}scheduler.task.abort`,
		]);
	});

	it("validates scheduler inputs and preserves explicit optional-field clearing", () => {
		expect(
			DOMAIN_SCHEDULER_CAPABILITIES.CREATE_TASK.parseInput({
				data: {
					name: "Daily",
					prompt: "Run",
					schedule: { kind: "weekly", weekdays: [1, 3], hour: 9, minute: 30 },
					runTarget: {
						mode: SCHEDULER_RUN_TARGET_MODES.SAME_SESSION,
						projectCwd: "C:/workspace",
						sessionPath: null,
					},
					model: { key: "anthropic/claude", reasoning: "high" },
					enabled: true,
				},
				ignored: true,
			}),
		).toEqual({
			data: {
				name: "Daily",
				prompt: "Run",
				schedule: { kind: "weekly", weekdays: [1, 3], hour: 9, minute: 30 },
				runTarget: { mode: SCHEDULER_RUN_TARGET_MODES.SAME_SESSION, projectCwd: "C:/workspace", sessionPath: null },
				model: { key: "anthropic/claude", reasoning: "high" },
				enabled: true,
			},
		});
		const update = DOMAIN_SCHEDULER_CAPABILITIES.UPDATE_TASK.parseInput({
			taskId: "task",
			data: { model: null, notification: null },
		});
		expect(update.data).toEqual({ model: null, notification: null });
		expect(() => DOMAIN_SCHEDULER_CAPABILITIES.UPDATE_TASK.parseInput({ taskId: "task", data: {} })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		for (const schedule of [
			{ kind: "daily", hour: 24, minute: 0 },
			{ kind: "monthly", days: [], hour: 9, minute: 0 },
			{ kind: "weekly", weekdays: [7], hour: 9, minute: 0 },
		]) {
			expect(() =>
				DOMAIN_SCHEDULER_CAPABILITIES.CREATE_TASK.parseInput({
					data: {
						name: "Daily",
						prompt: "Run",
						schedule,
						runTarget: { mode: SCHEDULER_RUN_TARGET_MODES.NEW_SESSION, projectCwd: "C:/workspace" },
						enabled: true,
					},
				}),
			).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		}
	});

	it("cleans task and history outputs while validating nested statuses", () => {
		const task = {
			id: "task",
			name: "Monthly",
			prompt: "Run",
			schedule: { kind: "monthly", days: [1, "last"], hour: 9, minute: 0 },
			runTarget: { mode: SCHEDULER_RUN_TARGET_MODES.NEW_SESSION, projectCwd: "C:/workspace" },
			enabled: false,
			suspendedReason: "project-removed",
			createdAt: 1,
			updatedAt: 2,
			lastRunAt: null,
			lastRunStatus: null,
			ignored: true,
		};
		const parsedTask = DOMAIN_SCHEDULER_CAPABILITIES.GET_TASK.parseOutput(task);
		expect(parsedTask).not.toHaveProperty("ignored");
		expect(parsedTask.schedule).toEqual({ kind: "monthly", days: [1, "last"], hour: 9, minute: 0 });

		expect(
			DOMAIN_SCHEDULER_CAPABILITIES.LIST_HISTORY.parseOutput([
				{
					id: "record",
					taskId: "task",
					startedAt: 1,
					completedAt: 1,
					status: SCHEDULER_RECORD_STATUSES.MISSED,
					reason: SCHEDULER_NOT_RUN_REASONS.APP_NOT_RUNNING,
					missedCount: 3,
					missedUntil: 3,
					prompt: "Run",
					responsePreview: "",
					ignored: true,
				},
			]),
		).toEqual([
			{
				id: "record",
				taskId: "task",
				startedAt: 1,
				completedAt: 1,
				status: SCHEDULER_RECORD_STATUSES.MISSED,
				reason: SCHEDULER_NOT_RUN_REASONS.APP_NOT_RUNNING,
				missedCount: 3,
				missedUntil: 3,
				prompt: "Run",
				responsePreview: "",
			},
		]);
		expect(() =>
			DOMAIN_SCHEDULER_CAPABILITIES.LIST_HISTORY.parseOutput([
				{
					id: "record",
					taskId: "task",
					startedAt: 1,
					completedAt: null,
					status: "queued",
					prompt: "Run",
					responsePreview: "",
				},
			]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("publishes task mutation and execution history schemas", () => {
		expect(DOMAIN_SCHEDULER_CAPABILITY_CATALOG).toHaveLength(9);
		expect(DOMAIN_SCHEDULER_CAPABILITY_CATALOG[2]?.outputSchema).toMatchObject({
			type: "array",
			items: {
				type: "object",
				required: ["id", "taskId", "startedAt", "completedAt", "status", "prompt", "responsePreview"],
			},
		});
		expect(DOMAIN_SCHEDULER_CAPABILITY_CATALOG[3]?.inputSchema).toMatchObject({
			type: "object",
			required: ["data"],
			properties: {
				data: {
					type: "object",
					additionalProperties: false,
					required: ["name", "prompt", "schedule", "runTarget", "enabled"],
				},
			},
		});
		expect(DOMAIN_SCHEDULER_CAPABILITY_CATALOG[4]?.inputSchema).toMatchObject({
			properties: {
				data: {
					type: "object",
					additionalProperties: false,
					minProperties: 1,
				},
			},
		});
		expect(() => JSON.stringify(DOMAIN_SCHEDULER_CAPABILITY_CATALOG)).not.toThrow();
	});
});
