// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PerfSessionSwitchProfiler } from "./perf-session-switch-profiler";

const diagnostics = vi.hoisted(() => ({ enabled: false, record: vi.fn() }));

vi.mock("./perf-session-switch", () => ({
	perfSessionSwitchEnabled: () => diagnostics.enabled,
	perfSessionSwitchRecordReactCommit: diagnostics.record,
}));

afterEach(() => {
	diagnostics.enabled = false;
	diagnostics.record.mockReset();
});

it("does not install a React Profiler while session-switch diagnostics are disabled", () => {
	render(
		<PerfSessionSwitchProfiler id="message-list">
			<div>content</div>
		</PerfSessionSwitchProfiler>,
	);

	expect(diagnostics.record).not.toHaveBeenCalled();
});

it("records commits after session-switch diagnostics are enabled", () => {
	diagnostics.enabled = true;
	render(
		<PerfSessionSwitchProfiler id="message-list">
			<div>content</div>
		</PerfSessionSwitchProfiler>,
	);

	expect(diagnostics.record).toHaveBeenCalledWith(
		"message-list",
		"mount",
		expect.any(Number),
		expect.any(Number),
	);
});
