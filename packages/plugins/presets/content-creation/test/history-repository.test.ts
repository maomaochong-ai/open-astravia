import { describe, expect, it } from "vitest";
import { captureContentProjectHistorySnapshot, createContentProjectHistoryState } from "../src/project/history";
import { parseStoredContentProjectHistory } from "../src/project/history-repository";
import { createContentProject } from "../src/project/types";

describe("content project history repository", () => {
	it("parses a valid project-scoped history document", () => {
		const project = createContentProject("C:/project");
		const present = captureContentProjectHistorySnapshot(project);

		expect(
			parseStoredContentProjectHistory(
				{
					schemaVersion: 1,
					projectId: project.projectId,
					present,
					history: createContentProjectHistoryState(),
				},
				project.projectId,
			),
		).toMatchObject({ projectId: project.projectId, history: { past: [], future: [] } });
	});

	it("rejects another project's or malformed history", () => {
		const project = createContentProject("C:/project");
		const present = captureContentProjectHistorySnapshot(project);

		expect(
			parseStoredContentProjectHistory(
				{
					schemaVersion: 1,
					projectId: project.projectId,
					present,
					history: { past: [], future: [] },
				},
				"another-project",
			),
		).toBeNull();
		expect(parseStoredContentProjectHistory({ schemaVersion: 1 }, project.projectId)).toBeNull();
	});
});
