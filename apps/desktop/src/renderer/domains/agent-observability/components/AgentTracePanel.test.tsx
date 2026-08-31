// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTracePage } from "@/shared/agent-traces";
import { AgentTracePanel } from "./AgentTracePanel";

const query = vi.hoisted(() => vi.fn());
vi.mock("@shared/host-api", () => ({ hostApi: { agentTraces: { query } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
describe("Agent Trace diagnostic interactions", () => {
	beforeEach(() => {
		query.mockReset();
		query.mockResolvedValue(page());
	});
	afterEach(cleanup);
	it("loads the selected session, expands safe identity/usage and applies failure and Turn filters", async () => {
		render(<AgentTracePanel sessionId="session" />);
		const span = await screen.findByRole("button", { name: /agent.run/ });
		fireEvent.click(span);
		expect(span.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("instance-id")).toBeTruthy();
		expect(screen.getByText("42")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "agentTraces.errorsOnly" }));
		await waitFor(() => expect(query).toHaveBeenLastCalledWith({ sessionId: "session", errorsOnly: true }));
		fireEvent.change(screen.getByLabelText("agentTraces.turnFilter"), { target: { value: "turn-2" } });
		fireEvent.click(screen.getByRole("button", { name: "agentTraces.filter" }));
		await waitFor(() =>
			expect(query).toHaveBeenLastCalledWith({ sessionId: "session", errorsOnly: true, turnId: "turn-2" }),
		);
	});
	it("keeps query errors safe and permits explicit refresh", async () => {
		query.mockRejectedValueOnce(new Error("private error"));
		render(<AgentTracePanel sessionId="session" />);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(document.body.textContent).not.toContain("private error");
		fireEvent.click(screen.getByRole("button", { name: "agentTraces.refresh" }));
		expect(await screen.findByRole("button", { name: /agent.run/ })).toBeTruthy();
	});
	it("ignores a stale response after changing conversations", async () => {
		let resolve!: (value: AgentTracePage) => void;
		query.mockReturnValueOnce(
			new Promise<AgentTracePage>((done) => {
				resolve = done;
			}),
		);
		const view = render(<AgentTracePanel sessionId="old" />);
		query.mockResolvedValue({ ...page(), records: [] });
		view.rerender(<AgentTracePanel sessionId="new" />);
		await screen.findByText("agentTraces.empty");
		await act(async () => resolve(page()));
		expect(screen.queryByRole("button", { name: /agent.run/ })).toBeNull();
	});
	it("loads further pages without losing the already loaded trace", async () => {
		query.mockResolvedValueOnce({ ...page(), nextCursor: "1:a" });
		render(<AgentTracePanel sessionId="session" />);
		fireEvent.click(await screen.findByRole("button", { name: "agentTraces.more" }));
		await waitFor(() =>
			expect(query).toHaveBeenLastCalledWith({ sessionId: "session", errorsOnly: false, cursor: "1:a" }),
		);
		expect(screen.getAllByRole("button", { name: /agent.run/ })).toHaveLength(1);
	});
});
function page(): AgentTracePage {
	return {
		nextCursor: null,
		health: { records: 1, dropped: 0, issue: null },
		records: [
			{
				schemaVersion: 1,
				id: "span",
				traceId: "trace",
				kind: "agent",
				name: "agent.run",
				startedAt: 1,
				endedAt: 10,
				state: "completed",
				context: { sessionId: "session", instanceId: "instance-id" },
				metadata: { configurationRevision: 2 },
				usage: { totalTokens: 42 },
				cost: {},
			},
		],
	};
}
