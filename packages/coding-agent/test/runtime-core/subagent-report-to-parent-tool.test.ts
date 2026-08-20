import { describe, expect, it, vi } from "vitest";
import {
	createSubagentReportToParentToolRegistration,
	formatSubagentReport,
	type SubagentReportEnvelope,
} from "../../src/composition/subagent/report-to-parent-tool.js";

describe("subagent report_to_parent tool", () => {
	it("delivers structured progress with artifacts and functional validation", async () => {
		const reports: SubagentReportEnvelope[] = [];
		const onReport = vi.fn(async (envelope: SubagentReportEnvelope) => {
			reports.push(envelope);
		});
		const registration = createSubagentReportToParentToolRegistration({
			id: "child-1",
			taskName: "runtime_contract",
			onReport,
		});
		const input = {
			status: "validation" as const,
			summary: "The contract test now passes.",
			artifacts: [{ path: "packages/example/src/contract.ts", summary: "Added the stable contract." }],
			validation: [{ name: "contract.test.ts", outcome: "passed" as const }],
		};

		await registration.tool.execute({
			sessionId: "child-1",
			turnId: "turn-1",
			toolCallId: "report-1",
			signal: new AbortController().signal,
			input,
		});

		expect(onReport).toHaveBeenCalledWith({
			id: "child-1",
			taskName: "runtime_contract",
			path: "/root/runtime_contract",
			report: input,
		});
		expect(formatSubagentReport(reports[0]!)).toContain("validation: [passed] contract.test.ts");
	});
});
