import { PluginAppActionError } from "@astravia-org/plugin-sdk";

export function throwEntityNotFound(options: {
	operation: string;
	entity: string;
	idField: string;
	id: string;
	queryAction: string;
	queryExample: Record<string, unknown>;
	resultIdPath: string;
	availableIds: string[];
	extra?: string;
}): never {
	const extra = options.extra ? ` ${options.extra}` : "";
	throw new PluginAppActionError(
		"ACTION_NOT_FOUND",
		`Cannot ${options.operation}: ${options.entity} ${options.idField}=${JSON.stringify(options.id)} was not found. No approval was shown. Call ${options.queryAction} with ${JSON.stringify(options.queryExample)} and use ${options.resultIdPath}.${extra}`,
		{
			operation: options.operation,
			field: options.idField,
			value: options.id,
			queryAction: options.queryAction,
			queryExample: options.queryExample,
			resultIdPath: options.resultIdPath,
			availableIds: options.availableIds,
		},
	);
}

export function throwInvalidInput(message: string, details?: Record<string, unknown>): never {
	throw new PluginAppActionError("ACTION_INVALID_INPUT", message, details);
}
