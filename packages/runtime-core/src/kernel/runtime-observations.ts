import { defineRuntimeObservation, type RuntimeObservationFailure } from "../observation/index.js";

export type RuntimePromptFrameObservation =
	| { readonly phase: "started"; readonly providerCount: number }
	| {
			readonly phase: "completed";
			readonly durationMs: number;
			readonly instructionCount: number;
			readonly toolCount: number;
	  }
	| { readonly phase: "failed"; readonly durationMs: number; readonly failure: RuntimeObservationFailure };

export type RuntimeToolExecutionObservation =
	| { readonly phase: "started"; readonly toolName: string; readonly inputFieldCount: number }
	| {
			readonly phase: "completed";
			readonly toolName: string;
			readonly durationMs: number;
			readonly contentItemCount: number;
			readonly hasDetails: boolean;
	  }
	| {
			readonly phase: "failed";
			readonly toolName: string;
			readonly durationMs: number;
			readonly failure: RuntimeObservationFailure;
	  };

export const RUNTIME_PROMPT_FRAME_OBSERVATION = defineRuntimeObservation<RuntimePromptFrameObservation>(
	"runtime.prompt",
	"frame",
);

export const RUNTIME_TOOL_EXECUTION_OBSERVATION = defineRuntimeObservation<RuntimeToolExecutionObservation>(
	"runtime.tool",
	"execution",
);
