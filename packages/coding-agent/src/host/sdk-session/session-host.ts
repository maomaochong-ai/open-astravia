import {
	CODING_AGENT_SESSION_CREATE_ERROR_CODES,
	CodingAgentSessionCreateError,
	type CreateCodingAgentSessionOptions,
	type CreateCodingAgentSessionResult,
} from "../../public-api/sdk/index.js";
import {
	CODING_AGENT_SDK_HOST_ERROR_CODES,
	CodingAgentSdkHostError,
	type CodingAgentSdkPublicHostContext,
} from "./contracts.js";
import { createNodeCodingAgentSdkSessionComposition } from "./node-session-host.js";

/** Map the compatibility Node host result onto the stable public SDK contract. */
export async function createCodingAgentSessionFromPublicOptions(
	options: CreateCodingAgentSessionOptions = {},
	hostContext: CodingAgentSdkPublicHostContext = {},
): Promise<CreateCodingAgentSessionResult> {
	try {
		const created = await createNodeCodingAgentSdkSessionComposition(options, hostContext);
		return {
			session: created.session,
			diagnostics: created.extensionsResult.errors.map(({ path, error }) => ({
				code: "extension_load_failed",
				severity: "error",
				source: path,
				message: error,
			})),
			...(created.modelFallbackMessage ? { modelFallbackMessage: created.modelFallbackMessage } : {}),
		};
	} catch (error) {
		if (error instanceof CodingAgentSdkHostError && error.code === CODING_AGENT_SDK_HOST_ERROR_CODES.NO_MODEL) {
			throw new CodingAgentSessionCreateError(CODING_AGENT_SESSION_CREATE_ERROR_CODES.NO_MODEL, error.message, {
				cause: error,
			});
		}
		throw error;
	}
}
