// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { newSessionAgentConfigurationAtom } from "@shared/store/atoms";
import { DEFAULT_AGENT_CONFIGURATION } from "@vetta/coding-agent/profile";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigurationPanel } from "./AgentConfigurationPanel";
import { ResourceSelectionField } from "./ResourceSelectionField";
import { useState } from "react";

const api = vi.hoisted(() => ({ listTemplates: vi.fn(), readSession: vi.fn(), readCatalog: vi.fn(), saveTemplate: vi.fn(), deleteTemplate: vi.fn(), updateSession: vi.fn() }));
vi.mock("@shared/host-api", () => ({ hostApi: { agentConfiguration: api } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@shared/store/atoms", async () => {
	const { atom } = await import("jotai");
	return { newSessionAgentConfigurationAtom: atom({ template: null, overrides: {} }), selectedModelAtom: atom("test/model"), reasoningByModelAtom: atom({}) };
});

describe("Agent configuration editor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDefaultStore().set(newSessionAgentConfigurationAtom, { template: null, overrides: {} });
		api.listTemplates.mockResolvedValue([]);
		api.readSession.mockResolvedValue(status(0));
		api.readCatalog.mockResolvedValue({ skills: [], tools: ["read"], mcpServers: [], plugins: [], models: [] });
		api.updateSession.mockResolvedValue(status(1));
	});
	afterEach(() => { cleanup(); vi.useRealTimers(); });

	it("saves a next-turn override through the session endpoint and keeps the template repository unchanged", async () => {
		const applied = vi.fn(); render(<AgentConfigurationPanel sessionId="session" onApplied={applied} />);
		const prompt = await screen.findByLabelText("agentConfiguration.prompt");
		await waitFor(() => expect(prompt.hasAttribute("disabled")).toBe(false));
		fireEvent.change(prompt, { target: { value: "Private instructions" } });
		fireEvent.click(screen.getByRole("button", { name: "agentConfiguration.applyNextTurn" }));
		await waitFor(() => expect(api.updateSession).toHaveBeenCalledWith("session", { expectedRevision: 0, selection: { template: null, overrides: expect.objectContaining({ appendSystemPrompt: "Private instructions" }) } }));
		expect(api.saveTemplate).not.toHaveBeenCalled(); expect(applied).toHaveBeenCalledOnce();
	});

	it("stores an independent new-session draft and allows saving it as a reusable template", async () => {
		const applied = vi.fn();
		api.saveTemplate.mockResolvedValue({ id: "writer", revision: 1, name: "Writer", configuration: { ...DEFAULT_AGENT_CONFIGURATION, appendSystemPrompt: "Write clearly" } });
		render(<AgentConfigurationPanel onApplied={applied} />);
		const name = await screen.findByLabelText("agentConfiguration.templateName");
		await waitFor(() => expect(name.hasAttribute("disabled")).toBe(false));
		fireEvent.change(name, { target: { value: "Writer" } });
		fireEvent.change(screen.getByLabelText("agentConfiguration.prompt"), { target: { value: "Write clearly" } });
		fireEvent.click(screen.getByRole("button", { name: "agentConfiguration.saveCopy" }));
		await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 0, name: "Writer" })));
		await waitFor(() => expect(screen.getByRole("button", { name: "agentConfiguration.useForNewSession" }).hasAttribute("disabled")).toBe(false));
		fireEvent.click(screen.getByRole("button", { name: "agentConfiguration.useForNewSession" }));
		await waitFor(() => expect(applied).toHaveBeenCalledOnce());
		expect(getDefaultStore().get(newSessionAgentConfigurationAtom)).toMatchObject({ template: { id: "writer", revision: 1 }, overrides: { appendSystemPrompt: "Write clearly" } });
		expect(api.updateSession).not.toHaveBeenCalled();
	});

	it("reports save failures without closing or discarding the edited prompt", async () => {
		const applied = vi.fn(); api.updateSession.mockRejectedValue(new Error("conflict"));
		render(<AgentConfigurationPanel sessionId="session" onApplied={applied} />);
		const prompt = await screen.findByLabelText("agentConfiguration.prompt");
		await waitFor(() => expect(prompt.hasAttribute("disabled")).toBe(false));
		fireEvent.change(prompt, { target: { value: "Keep this draft" } });
		fireEvent.click(screen.getByRole("button", { name: "agentConfiguration.applyNextTurn" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect((prompt as HTMLTextAreaElement).value).toBe("Keep this draft"); expect(applied).not.toHaveBeenCalled();
	});

	it("does not let status polling advance the edit's compare-and-swap revision", async () => {
		render(<AgentConfigurationPanel sessionId="session" onApplied={() => {}} />);
		await waitFor(() => expect(screen.getByRole("button", { name: "agentConfiguration.applyNextTurn" }).hasAttribute("disabled")).toBe(false));
		vi.useFakeTimers();
		api.readSession.mockResolvedValue(status(2));
		// The existing interval uses the real timer clock; remount under the controlled clock.
		cleanup();
		api.readSession.mockResolvedValueOnce(status(0));
		render(<AgentConfigurationPanel sessionId="session" onApplied={() => {}} />);
		await act(async () => { await Promise.resolve(); await Promise.resolve(); });
		await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
		fireEvent.click(screen.getByRole("button", { name: "agentConfiguration.applyNextTurn" }));
		await act(async () => { await Promise.resolve(); });
		expect(api.updateSession).toHaveBeenCalledWith("session", expect.objectContaining({ expectedRevision: 0 }));
	});

	it("allows multiline resource editing and accessible catalog toggles", () => {
		function Field() { const [value, setValue] = useState<string[] | null>(["alpha"]); return <ResourceSelectionField kind="skills" value={value} available={["alpha", "beta"]} disabled={false} onChange={setValue} />; }
		render(<Field />);
		const input = screen.getByLabelText("agentConfiguration.resourceIds") as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "alpha\n" } }); expect(input.value).toBe("alpha\n");
		fireEvent.change(input, { target: { value: "alpha\nbeta" } }); expect(screen.getByRole("button", { name: "beta" }).getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "alpha" })); expect(input.value).toBe("beta");
	});
});

function status(revision: number) { return { desired: { schemaVersion: 1, revision, selection: { template: null, overrides: {} } }, resolved: { ...DEFAULT_AGENT_CONFIGURATION }, effectiveRevision: 0, pending: revision !== 0, failure: null }; }
