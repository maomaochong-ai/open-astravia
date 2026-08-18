import { CapabilityHub } from "@vetta/capability-runtime";
import { FOUNDATION_JOB_CAPABILITIES, JOB_ERROR_CODES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { JobManager } from "../jobs/job-manager.js";
import { registerDesktopJobProvider } from "./job-provider.js";

describe("desktop foundation job provider", () => {
	it("returns the real job-not-found contract instead of throwing a provider error", async () => {
		const hub = new CapabilityHub();
		const jobs = new JobManager();
		const registration = registerDesktopJobProvider(hub.foundation, jobs);

		try {
			const result = await hub.invoke(
				FOUNDATION_JOB_CAPABILITIES.GET,
				{ ownerId: "content-creation", id: "missing-job" },
				{ signal: new AbortController().signal, traceId: "job-not-found-contract" },
			);

			expect(result.status).toBe("failed");
			expect(result.error).toMatchObject({ code: JOB_ERROR_CODES.NOT_FOUND, retryable: false });
		} finally {
			registration.dispose();
			jobs.dispose();
		}
	});
});
