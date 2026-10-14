// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectInstruction } from "./useProjectDetailPageModel";

const readFile = vi.fn();
const writeFile = vi.fn();

Object.defineProperty(window, "vetta", {
	configurable: true,
	value: { fs: { readFile, writeFile } },
});

afterEach(() => {
	vi.resetAllMocks();
});

describe("project instruction files", () => {
	it("keeps each unsaved draft while switching between AGENTS.md and CLAUDE.md", async () => {
		readFile.mockImplementation(async (path: string) => ({ content: path.endsWith("CLAUDE.md") ? "Claude rules" : "Agent rules" }));
		writeFile.mockResolvedValue(undefined);
		const { result, rerender } = renderHook(
			({ active }: { active: "AGENTS.md" | "CLAUDE.md" }) => ({
				agents: useProjectInstruction("/project", "AGENTS.md", true),
				claude: useProjectInstruction("/project", "CLAUDE.md", active === "CLAUDE.md"),
			}),
			{ initialProps: { active: "AGENTS.md" as "AGENTS.md" | "CLAUDE.md" } },
		);
		await waitFor(() => expect(result.current.agents.content).toBe("Agent rules"));
		act(() => result.current.agents.setContent("Draft agent rules"));
		rerender({ active: "CLAUDE.md" });
		await waitFor(() => expect(result.current.claude.content).toBe("Claude rules"));
		act(() => result.current.claude.setContent("Draft Claude rules"));
		rerender({ active: "AGENTS.md" });
		expect(result.current.agents.content).toBe("Draft agent rules");
		expect(result.current.claude.content).toBe("Draft Claude rules");
		expect(result.current.agents.isDirty).toBe(true);
		expect(result.current.claude.isDirty).toBe(true);
		expect(readFile.mock.calls.map(([path]) => path)).toEqual(["/project/AGENTS.md", "/project/CLAUDE.md"]);
	});

	it("creates CLAUDE.md when missing and reports a failed save without losing the draft", async () => {
		readFile.mockRejectedValue(new Error("ENOENT"));
		writeFile.mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(undefined);
		const { result } = renderHook(() => useProjectInstruction("/project", "CLAUDE.md", true));
		await waitFor(() => expect(result.current.loading).toBe(false));
		act(() => result.current.setContent("Claude rules"));
		await act(async () => result.current.save());
		expect(result.current.saveStatus).toBe("error");
		expect(result.current.isDirty).toBe(true);
		await act(async () => result.current.save());
		expect(writeFile).toHaveBeenLastCalledWith("/project/CLAUDE.md", "Claude rules");
		expect(result.current.saveStatus).toBe("saved");
		expect(result.current.isDirty).toBe(false);
	});
});
