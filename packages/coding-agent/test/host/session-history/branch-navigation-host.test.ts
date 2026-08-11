import type { Api, Model } from "@vetta/ai";
import type { ConversationDocument, RuntimeSession, RuntimeSessionCoreAssembly } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionRunner } from "../../../src/extensions/index.js";
import { CodingAgentBranchNavigationHost } from "../../../src/host/session-history/branch-navigation-host.js";

describe("CodingAgentBranchNavigationHost", () => {
	it("preserves Extension summary, label and tree event semantics", async () => {
		const fixture = createFixture({ extensionSummary: "extension summary" });
		const host = new CodingAgentBranchNavigationHost({
			withActiveSession: fixture.withActiveSession,
			readRunner: () => fixture.runner,
			settingsManager: { getBranchSummarySettings: () => ({ reserveTokens: 1234 }) },
			clearExecutionContext: fixture.clearExecutionContext,
		});

		await expect(host.navigateTree("target", { summarize: true, label: "return point" })).resolves.toEqual({
			cancelled: false,
			editorText: "target branch",
			summaryEntry: expect.objectContaining({ id: "summary", summary: "extension summary" }),
		});

		expect(fixture.appendBranchSummary).toHaveBeenCalledWith(null, "extension summary", undefined, true);
		expect(fixture.setLabel).toHaveBeenCalledWith("summary", "return point");
		expect(fixture.clearExecutionContext).toHaveBeenCalledWith("session-1");
		expect(fixture.emit).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				type: "session_tree",
				oldLeafId: "old",
				newLeafId: "label",
				fromExtension: true,
				summaryEntry: expect.objectContaining({ id: "summary", summary: "extension summary" }),
			}),
		);
	});

	it("uses the existing summary generator and Runtime model credentials", async () => {
		const fixture = createFixture();
		const generateSummary = vi.fn(async () => ({
			summary: "generated summary",
			readFiles: ["README.md"],
			modifiedFiles: ["src/index.ts"],
		}));
		const host = new CodingAgentBranchNavigationHost({
			withActiveSession: fixture.withActiveSession,
			readRunner: () => fixture.runner,
			settingsManager: { getBranchSummarySettings: () => ({ reserveTokens: 2048 }) },
			generateSummary,
			clearExecutionContext: fixture.clearExecutionContext,
		});

		await host.navigateTree("target", { summarize: true, customInstructions: "focus" });

		expect(generateSummary).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ id: "old" })]),
			expect.objectContaining({
				apiKey: "test-key",
				customInstructions: "focus",
				reserveTokens: 2048,
			}),
		);
		expect(fixture.appendBranchSummary).toHaveBeenCalledWith(
			null,
			"generated summary",
			{ readFiles: ["README.md"], modifiedFiles: ["src/index.ts"] },
			false,
		);
	});
});

function createFixture(options: { readonly extensionSummary?: string } = {}) {
	let document: ConversationDocument = {
		identity: { sessionId: "session-1", createdAt: 1, cwd: "C:/workspace" },
		journalVersion: 0,
		revision: 2,
		activeLeafId: "old",
		entries: [
			{
				type: "custom_message",
				id: "old",
				parentId: null,
				timestamp: new Date(1).toISOString(),
				customType: "fixture",
				content: "old branch",
				display: true,
			},
			{
				type: "custom_message",
				id: "target",
				parentId: null,
				timestamp: new Date(2).toISOString(),
				customType: "fixture",
				content: "target branch",
				display: true,
			},
		],
	};
	const model = { provider: "test" } as unknown as Model<Api>;
	const clearExecutionContext = vi.fn();
	const appendBranchSummary = vi.fn(
		async (parentId: string | null, summary: string, details?: unknown, fromHook?: boolean) => {
			document = {
				...document,
				activeLeafId: "summary",
				entries: [
					...document.entries,
					{
						type: "branch_summary",
						id: "summary",
						parentId,
						timestamp: new Date(3).toISOString(),
						fromId: parentId ?? "root",
						summary,
						details,
						fromHook,
					},
				],
			};
			return { entryId: "summary" };
		},
	);
	const setLabel = vi.fn(async (targetId: string, label: string | undefined) => {
		document = {
			...document,
			activeLeafId: "label",
			entries: [
				...document.entries,
				{
					type: "label",
					id: "label",
					parentId: document.activeLeafId,
					timestamp: new Date(4).toISOString(),
					targetId,
					label,
				},
			],
		};
	});
	const assembly = {
		lifecycle: { sessionId: "session-1", sessionPath: "session.jsonl", dispose: async () => {} },
		conversationView: { readDocument: () => document },
		workspaceView: { readWorkingDirectory: () => "C:/workspace" },
		modelView: {
			readCurrentModel: () => model,
			resolveApiKey: async () => "test-key",
		},
		historyController: {
			appendBranchSummary,
			navigateForEdit: vi.fn(async () => ({ text: "target branch", cancelled: false })),
		},
		metadataController: { setLabel },
	} as unknown as RuntimeSessionCoreAssembly;
	const session = {
		sessionId: "session-1",
		createCoreAssembly: () => assembly,
	} as unknown as RuntimeSession;
	const emit = vi.fn(async (event: { readonly type: string }) => {
		if (event.type === "session_before_tree" && options.extensionSummary) {
			return { summary: { summary: options.extensionSummary } };
		}
		return undefined;
	});
	const runner = {
		hasHandlers: (event: string) => event === "session_before_tree" && options.extensionSummary !== undefined,
		emit,
	} as unknown as ExtensionRunner;
	const withActiveSession = async <T>(operation: (activeSession: RuntimeSession) => Promise<T>): Promise<T> =>
		operation(session);

	return { appendBranchSummary, clearExecutionContext, emit, runner, setLabel, withActiveSession };
}
