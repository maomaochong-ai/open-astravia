import { JOB_ERROR_CODES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { JobManager } from "./job-manager.js";

describe("JobManager", () => {
	it.each(["get", "cancel"] as const)("returns a terminal not-found job from %s", async (operation) => {
		const jobs = new JobManager();
		const result = await jobs[operation]("plugin:test", "missing-job", new AbortController().signal);

		expect(result).toEqual({
			id: "missing-job",
			domain: "job",
			operation,
			status: "failed",
			artifacts: [],
			error: {
				code: JOB_ERROR_CODES.NOT_FOUND,
				message: "Job is unavailable: missing-job",
				retryable: false,
			},
		});
	});

	it("does not reveal a job owned by another plugin", async () => {
		const jobs = new JobManager();
		const created = jobs.create({
			ownerId: "plugin:owner",
			domain: "media",
			operation: "generate",
			status: "running",
		});

		const result = await jobs.get("plugin:other", created.id, new AbortController().signal);

		expect(result.status).toBe("failed");
		expect(result.error?.code).toBe(JOB_ERROR_CODES.NOT_FOUND);
	});
});
