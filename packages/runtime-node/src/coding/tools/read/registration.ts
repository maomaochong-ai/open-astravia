import type { RuntimeConfigurationSnapshotSource } from "@vetta/runtime-core/configuration";
import {
	CODING_IMAGE_CONFIGURATION,
	type CodingToolRegistration,
	type CodingToolScope,
	withCodingToolConfiguration,
} from "@vetta/runtime-tools";
import { createReadTool, type ReadToolInput, type ReadToolOptions } from "./read-tool.js";

export const READ_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly CodingToolScope[];

export const READ_TOOL_CATEGORY = "core" as const;

export interface ReadToolRegistrationOptions extends ReadToolOptions {
	readonly configurationSource?: RuntimeConfigurationSnapshotSource;
}

export function createReadToolRegistration(
	cwd: string,
	options: ReadToolRegistrationOptions = {},
): CodingToolRegistration<ReadToolInput> {
	const { configurationSource, ...toolOptions } = options;
	const registration: CodingToolRegistration<ReadToolInput> = {
		tool: createReadTool(cwd, toolOptions),
		scopeUse: READ_TOOL_SCOPES,
		category: READ_TOOL_CATEGORY,
	};
	if (!configurationSource) return registration;
	return withCodingToolConfiguration(registration, {
		association: {
			configurationIds: [CODING_IMAGE_CONFIGURATION.id],
			requiredConfigurationIds: [CODING_IMAGE_CONFIGURATION.id],
			support: "native",
		},
		source: configurationSource,
		onMissingConfiguration: "fail",
		configure: ({ configuration }) => {
			const imageConfiguration = configuration.read(CODING_IMAGE_CONFIGURATION);
			if (!imageConfiguration) throw new Error("Coding image Runtime Configuration is unavailable");
			return createReadTool(cwd, {
				...toolOptions,
				autoResizeImages: imageConfiguration.autoResize,
				imageResizeOptions: imageConfiguration.resize,
			});
		},
	});
}
