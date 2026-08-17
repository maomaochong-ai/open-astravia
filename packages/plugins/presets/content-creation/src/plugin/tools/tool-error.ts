import { ContentGenerationPromptPlanError } from "../../agent/generation-prompt-plan";
import { ContentVideoShotPlanError } from "../../agent/video-shot-plan";
import { ContentGenerationIntentError } from "../../generation/generation-intent";
import { ContentLocalAssetError } from "../../generation/local-asset-service";
import { ContentProjectCommandError } from "../../project/commands";
import { ContentProjectRevisionError } from "../../project/workspace";

export function contentCreationToolError(error: unknown) {
	if (error instanceof ContentVideoShotPlanError) {
		return {
			ok: false,
			retryable: error.retryable,
			code: error.code,
			error: error.message,
			details: error.details,
		};
	}
	if (error instanceof ContentGenerationPromptPlanError) {
		return {
			ok: false,
			retryable: error.retryable,
			code: error.code,
			error: error.message,
			details: error.details,
		};
	}
	if (error instanceof ContentLocalAssetError) {
		return {
			ok: false,
			retryable: error.retryable,
			code: error.code,
			error: error.message,
			...(error.details ? { details: error.details } : {}),
		};
	}
	if (error instanceof ContentGenerationIntentError) {
		return {
			ok: false,
			retryable: error.retryable,
			code: error.code,
			error: error.message,
			...(error.details ? { details: error.details } : {}),
		};
	}
	if (error instanceof ContentProjectCommandError) {
		return {
			ok: false,
			retryable: false,
			code: error.code,
			error: error.message,
			...(error.details ? { details: error.details } : {}),
		};
	}
	return {
		ok: false,
		retryable: error instanceof ContentProjectRevisionError,
		error: error instanceof Error ? error.message : String(error),
	};
}
