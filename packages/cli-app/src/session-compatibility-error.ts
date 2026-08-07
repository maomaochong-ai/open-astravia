import type {
	CodingAgentHistoricalSessionIncompatibilityCode,
	CodingAgentHistoricalSessionMigrationIncompatible,
} from "@vetta/coding-agent/historical-sessions";
import type { RpcSessionIncompatibilityFailure } from "@vetta/coding-agent/rpc";

export class SessionCompatibilityError extends Error {
	readonly errorCode: CodingAgentHistoricalSessionIncompatibilityCode;
	readonly sessionPath: string;
	readonly sourceVersion: number | undefined;
	readonly issueCode: string | undefined;
	readonly issueCount: number | undefined;

	constructor(result: CodingAgentHistoricalSessionMigrationIncompatible) {
		super("Historical session cannot be imported safely");
		this.name = "SessionCompatibilityError";
		this.errorCode = result.errorCode;
		this.sessionPath = result.sourcePath;
		this.sourceVersion = result.sourceVersion;
		this.issueCode = result.issueCode;
		this.issueCount = result.issueCount;
	}

	toRpcStartupFailure(): RpcSessionIncompatibilityFailure {
		return {
			type: "response",
			command: "startup",
			success: false,
			errorCode: this.errorCode,
			phase: "startup",
			recoverability: "user_action",
			error: this.message,
			sessionPath: this.sessionPath,
			...(this.sourceVersion === undefined ? {} : { sourceVersion: this.sourceVersion }),
			...(this.issueCode === undefined ? {} : { issueCode: this.issueCode }),
			...(this.issueCount === undefined ? {} : { issueCount: this.issueCount }),
		};
	}
}
