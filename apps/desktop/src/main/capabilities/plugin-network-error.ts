import { CAPABILITY_ERROR_CODES, CapabilityError } from "@vetta/capability-sdk";
import { PluginNetworkError } from "../plugins/plugin-network-service.js";

export function toPluginNetworkCapabilityError(error: unknown): CapabilityError {
	if (error instanceof PluginNetworkError) {
		return new CapabilityError(
			CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
			error.message,
			{ cause: error },
			{ reason: error.reason },
		);
	}
	return new CapabilityError(
		CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
		"Plugin network request failed",
		{ cause: error },
		{ reason: "internal-failure" },
	);
}
