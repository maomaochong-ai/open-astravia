import type {
	BashToolInput as NodeBashToolInput,
	EditToolDetails as NodeEditToolDetails,
	EditToolInput as NodeEditToolInput,
	FindToolDetails as NodeFindToolDetails,
	FindToolInput as NodeFindToolInput,
	GlobToolDetails as NodeGlobToolDetails,
	GlobToolInput as NodeGlobToolInput,
	GrepToolDetails as NodeGrepToolDetails,
	GrepToolInput as NodeGrepToolInput,
	LsToolDetails as NodeLsToolDetails,
	LsToolInput as NodeLsToolInput,
	ReadToolDetails as NodeReadToolDetails,
	ReadToolInput as NodeReadToolInput,
	TreeToolDetails as NodeTreeToolDetails,
	TreeToolInput as NodeTreeToolInput,
	TruncationResult as NodeTruncationResult,
	WriteToolInput as NodeWriteToolInput,
} from "@vetta/runtime-node/coding";
import { describe, expectTypeOf, it } from "vitest";
import type {
	BashToolDetails as ExtensionBashToolDetails,
	BashToolInput as ExtensionBashToolInput,
	EditToolDetails as ExtensionEditToolDetails,
	EditToolInput as ExtensionEditToolInput,
	FindToolDetails as ExtensionFindToolDetails,
	FindToolInput as ExtensionFindToolInput,
	GlobToolDetails as ExtensionGlobToolDetails,
	GlobToolInput as ExtensionGlobToolInput,
	GrepToolDetails as ExtensionGrepToolDetails,
	GrepToolInput as ExtensionGrepToolInput,
	LsToolDetails as ExtensionLsToolDetails,
	LsToolInput as ExtensionLsToolInput,
	ReadToolDetails as ExtensionReadToolDetails,
	ReadToolInput as ExtensionReadToolInput,
	TreeToolDetails as ExtensionTreeToolDetails,
	TreeToolInput as ExtensionTreeToolInput,
	WriteToolInput as ExtensionWriteToolInput,
	ToolOutputTruncation,
} from "../src/extensions/index.js";

describe("extension tool event contracts", () => {
	it("match the Node built-in tool data exposed through the extension boundary", () => {
		expectTypeOf<ExtensionBashToolInput>().toEqualTypeOf<NodeBashToolInput>();
		expectTypeOf<ExtensionReadToolInput>().toEqualTypeOf<NodeReadToolInput>();
		expectTypeOf<ExtensionEditToolInput>().toEqualTypeOf<NodeEditToolInput>();
		expectTypeOf<ExtensionWriteToolInput>().toEqualTypeOf<NodeWriteToolInput>();
		expectTypeOf<ExtensionGrepToolInput>().toEqualTypeOf<NodeGrepToolInput>();
		expectTypeOf<ExtensionFindToolInput>().toEqualTypeOf<NodeFindToolInput>();
		expectTypeOf<ExtensionGlobToolInput>().toEqualTypeOf<NodeGlobToolInput>();
		expectTypeOf<ExtensionLsToolInput>().toEqualTypeOf<NodeLsToolInput>();
		expectTypeOf<ExtensionTreeToolInput>().toEqualTypeOf<NodeTreeToolInput>();

		expectTypeOf<ToolOutputTruncation>().toEqualTypeOf<NodeTruncationResult>();
		expectTypeOf<ExtensionReadToolDetails>().toEqualTypeOf<NodeReadToolDetails>();
		expectTypeOf<ExtensionEditToolDetails>().toEqualTypeOf<NodeEditToolDetails>();
		expectTypeOf<ExtensionGrepToolDetails>().toEqualTypeOf<NodeGrepToolDetails>();
		expectTypeOf<ExtensionFindToolDetails>().toEqualTypeOf<NodeFindToolDetails>();
		expectTypeOf<ExtensionGlobToolDetails>().toEqualTypeOf<NodeGlobToolDetails>();
		expectTypeOf<ExtensionLsToolDetails>().toEqualTypeOf<NodeLsToolDetails>();
		expectTypeOf<ExtensionTreeToolDetails>().toEqualTypeOf<NodeTreeToolDetails>();
		expectTypeOf<ExtensionBashToolDetails>().toMatchTypeOf<{
			truncation?: NodeTruncationResult;
		}>();
	});
});
