// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import {
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	backgroundTasksBySessionAtom,
	subagentsBySessionAtom,
} from "@shared/store/atoms";
import type { RuntimeSandboxGrantInfo } from "@vetta/runtime-core";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBackgroundTasksBadgeModel } from "./useBackgroundTasksBadgeModel";
import { useSandboxGrantsBadgeModel } from "./useSandboxGrantsBadgeModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string, values?: { count?: number }) => `${key}:${values?.count ?? ""}` }),
}));

const RUNTIME_IDS = ["runtime-a", "runtime-b"] as const;

function grant(runtimeId: string, id: string, createdAt: number): RuntimeSandboxGrantInfo {
	return {
		id,
		sessionId: runtimeId,
		toolName: `tool-${id}`,
		capability: "file.read",
		grantRoot: "/workspace",
		firstTarget: "/workspace/file.ts",
		createdAt,
	};
}

beforeEach(() => {
	Object.assign(window, {
		vetta: {
			session: {
				listSandboxGrants: vi.fn(async (runtimeId: string) => [grant(runtimeId, `grant-${runtimeId}`, Date.now())]),
				revokeSandboxGrant: vi.fn(async () => {}),
				revokeAllSandboxGrants: vi.fn(async () => {}),
			},
		},
	});
});

describe("header capability scopes", () => {
	it("aggregates background work from every Runtime and opens the owning activity workspace", () => {
		const store = createStore();
		store.set(
			backgroundTasksBySessionAtom,
			new Map([
				["runtime-a", [{ id: "task-a", command: "a", cwd: "/w", status: "running", outputFile: "", exitCode: undefined, startedAt: 1, tail: "" }]],
				["runtime-b", [{ id: "task-b", command: "b", cwd: "/w", status: "running", outputFile: "", exitCode: undefined, startedAt: 1, tail: "" }]],
			]),
		);
		store.set(
			subagentsBySessionAtom,
			new Map([
				["runtime-b", [{ id: "sub-b", taskName: "sub", path: "", agentType: "worker", status: "running", task: "", parentSessionId: "runtime-b", startedAt: 1, generation: 1 }]],
			]),
		);
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
		const { result } = renderHook(
			() => useBackgroundTasksBadgeModel(RUNTIME_IDS, "team-workspace"),
			{ wrapper },
		);

		expect(result.current.runningCount).toBe(3);
		act(() => result.current.onClick());
		expect(store.get(activityPanelOpenAtom)).toBe(true);
		expect(store.get(activityPanelTabByProjectAtom).get("team-workspace")).toBe("background-tasks");
	});

	it("lists and revokes grants against the Runtime that owns each grant", async () => {
		const { result, unmount } = renderHook(() => useSandboxGrantsBadgeModel(RUNTIME_IDS));

		await waitFor(() => expect(result.current?.count).toBe(2));
		act(() => result.current?.onRevoke("runtime-b:grant-runtime-b"));
		await waitFor(() =>
			expect(window.vetta.session.revokeSandboxGrant).toHaveBeenCalledWith("runtime-b", "grant-runtime-b"),
		);

		act(() => result.current?.onRevokeAll());
		await waitFor(() => expect(window.vetta.session.revokeAllSandboxGrants).toHaveBeenCalledTimes(2));
		expect(window.vetta.session.revokeAllSandboxGrants).toHaveBeenCalledWith("runtime-a");
		expect(window.vetta.session.revokeAllSandboxGrants).toHaveBeenCalledWith("runtime-b");
		unmount();
	});

	it("keeps grants from healthy Runtimes when another Runtime is unavailable", async () => {
		vi.mocked(window.vetta.session.listSandboxGrants).mockImplementation(async (runtimeId) => {
			if (runtimeId === "runtime-a") throw new Error("runtime unavailable");
			return [grant(runtimeId, `grant-${runtimeId}`, Date.now())];
		});

		const { result, unmount } = renderHook(() => useSandboxGrantsBadgeModel(RUNTIME_IDS));

		await waitFor(() => expect(result.current?.count).toBe(1));
		expect(result.current?.grants[0]?.id).toBe("runtime-b:grant-runtime-b");
		unmount();
	});
});
