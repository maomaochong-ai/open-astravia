import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	BATCH_EXECUTION_MODES,
	BATCH_SKILL_TYPES,
	BATCH_TASK_STATUSES,
	DOMAIN_BATCH_TASK_CAPABILITIES,
	DOMAIN_BATCH_TASK_CAPABILITY_CATALOG,
} from "../../src/domain.js";

describe("batch task domain capabilities", () => {
	it("uses one stable id per batch task operation", () => {
		expect(Object.values(DOMAIN_BATCH_TASK_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.list`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.get`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.create`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.update`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.delete`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.task.run`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.task.retry`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.task.stop`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.task.delete`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.task.resume`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.task.resume-with-text`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.task.session.delete`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.task.delete-all`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.start`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.stop`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.reset`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}batch-task.project.failed-task.reset`,
		]);
	});

	it("validates batch project data and preserves skill clearing", () => {
		expect(
			DOMAIN_BATCH_TASK_CAPABILITIES.CREATE_PROJECT.parseInput({
				data: {
					name: "Batch",
					prompt: "Process",
					folders: ["C:/source"],
					concurrency: 2,
					executionMode: BATCH_EXECUTION_MODES.SANDBOX,
				},
				ignored: true,
			}),
		).toEqual({
			data: {
				name: "Batch",
				prompt: "Process",
				folders: ["C:/source"],
				concurrency: 2,
				executionMode: BATCH_EXECUTION_MODES.SANDBOX,
			},
		});
		const update = DOMAIN_BATCH_TASK_CAPABILITIES.UPDATE_PROJECT.parseInput({
			projectId: "C:/workspace/Batch",
			data: { skill: null },
		});
		expect(update.data).toEqual({ skill: null });
		expect(() =>
			DOMAIN_BATCH_TASK_CAPABILITIES.CREATE_PROJECT.parseInput({
				data: { name: "Batch", prompt: "Process", folders: [], concurrency: 2 },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_BATCH_TASK_CAPABILITIES.CREATE_PROJECT.parseInput({
				data: {
					name: "Batch",
					prompt: "Process",
					folders: ["C:/source"],
					concurrency: 2,
					ignored: true,
				},
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_BATCH_TASK_CAPABILITIES.UPDATE_PROJECT.parseInput({
				projectId: "C:/workspace/Batch",
				data: {},
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("cleans project and task output while keeping skill objects strict", () => {
		const project = {
			id: "project-1",
			name: "Batch",
			prompt: "Process",
			concurrency: 2,
			tasks: [
				{
					id: "task-1",
					name: "Source",
					cwd: "C:/source",
					sourcePath: "C:/source",
					status: BATCH_TASK_STATUSES.PENDING,
					createdAt: 0,
					updatedAt: 0,
					ignored: true,
				},
			],
			createdAt: 0,
			updatedAt: 0,
			ignored: true,
		};
		const parsed = DOMAIN_BATCH_TASK_CAPABILITIES.GET_PROJECT.parseOutput(project);
		expect(parsed).not.toHaveProperty("ignored");
		expect(parsed).not.toHaveProperty("tasks.0.ignored");
		expect(() =>
			DOMAIN_BATCH_TASK_CAPABILITIES.GET_PROJECT.parseOutput({
				...project,
				skill: { name: "review", type: BATCH_SKILL_TYPES.SKILL, ignored: true },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() =>
			DOMAIN_BATCH_TASK_CAPABILITIES.GET_PROJECT.parseOutput({
				...project,
				tasks: [{ ...project.tasks[0], executionMode: BATCH_EXECUTION_MODES.INHERIT }],
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("publishes nested project mutation and task schemas", () => {
		expect(DOMAIN_BATCH_TASK_CAPABILITY_CATALOG).toHaveLength(17);
		expect(DOMAIN_BATCH_TASK_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "array",
			items: {
				type: "object",
				required: ["id", "name", "prompt", "concurrency", "tasks", "createdAt", "updatedAt"],
				properties: {
					tasks: {
						type: "array",
						items: {
							type: "object",
							required: ["id", "name", "cwd", "sourcePath", "status", "createdAt", "updatedAt"],
						},
					},
				},
			},
		});
		expect(DOMAIN_BATCH_TASK_CAPABILITY_CATALOG[2]?.inputSchema).toMatchObject({
			properties: {
				data: {
					required: ["name", "prompt", "folders", "concurrency"],
					properties: {
						folders: { type: "array", minItems: 1, items: { type: "string", pattern: "\\S" } },
						concurrency: { type: "integer", minimum: 1, maximum: 64 },
						timeoutMinutes: { type: "integer", minimum: 1, maximum: 10_080 },
					},
				},
			},
		});
		expect(DOMAIN_BATCH_TASK_CAPABILITY_CATALOG[3]?.inputSchema).toMatchObject({
			properties: {
				data: {
					type: "object",
					minProperties: 1,
					additionalProperties: false,
					properties: {
						skill: {
							anyOf: [
								{
									type: "object",
									required: ["name", "type"],
								},
								{ type: "null" },
							],
						},
					},
				},
			},
		});
		expect(() => JSON.stringify(DOMAIN_BATCH_TASK_CAPABILITY_CATALOG)).not.toThrow();
	});
});
