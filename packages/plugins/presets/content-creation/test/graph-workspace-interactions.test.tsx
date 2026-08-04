import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContentProject } from "../src/project/types";
import { GraphWorkspace } from "../src/canvas/GraphWorkspace";

const reactFlowCapture = vi.hoisted(() => ({
	props: null as Record<string, unknown> | null,
}));

vi.mock("@xyflow/react", () => ({
	Controls: () => null,
	SelectionMode: { Partial: "partial" },
	ReactFlow: (props: Record<string, unknown>) => {
		reactFlowCapture.props = props;
		return <div />;
	},
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	usePluginShortcutScope: () => undefined,
}));

vi.mock("../src/node/ContentNodeCard", () => ({
	ContentNodeCard: () => null,
}));

vi.mock("../src/canvas/AlignmentGuidesLayer", () => ({
	AlignmentGuidesLayer: () => null,
}));

vi.mock("../src/canvas/GraphOverlayLayer", () => ({
	GraphOverlayLayer: () => null,
}));

vi.mock("../src/canvas/SelectionToolbar", () => ({
	SelectionToolbar: () => null,
}));

describe("GraphWorkspace mouse interactions", () => {
	beforeEach(() => {
		reactFlowCapture.props = null;
	});

	it("uses primary-button drag for canvas panning and Control-drag for box selection", () => {
		renderToStaticMarkup(
			<GraphWorkspace
				project={createContentProject("C:\\project")}
				models={[]}
				onDispatch={async () => undefined}
				onRunNode={async () => undefined}
				onImportReferences={async () => undefined}
			/>,
		);

		expect(reactFlowCapture.props?.selectionOnDrag).toBe(false);
		expect(reactFlowCapture.props?.selectionKeyCode).toBe("Control");
		expect(reactFlowCapture.props?.selectionMode).toBe("partial");
		expect(reactFlowCapture.props?.panOnDrag).toBe(true);
	});
});
