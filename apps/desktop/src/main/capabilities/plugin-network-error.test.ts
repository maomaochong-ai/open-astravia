import { CAPABILITY_ERROR_CODES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PluginNetworkError } from "../plugins/plugin-network-service.js";
import { toPluginNetworkCapabilityError } from "./plugin-network-error.js";

describe("plugin network capability errors", () => {
	it("keeps the diagnostic chain and exposes the safe network failure", () => {
		const diagnostic = new Error("request URL contained ?token=secret");
		const networkError = new PluginNetworkError(
			"transport-failed",
			"Plugin network request failed (ERR_CONNECTION_RESET)",
			{ cause: diagnostic },
		);

		const failure = toPluginNetworkCapabilityError(networkError);

		expect(failure).toMatchObject({
			code: CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
			message: "Plugin network request failed (ERR_CONNECTION_RESET)",
			details: { reason: "transport-failed" },
			cause: networkError,
		});
		expect(failure.message).not.toContain("token=secret");
	});

	it("does not expose messages from unknown failures", () => {
		const diagnostic = new Error("internal path C:/secret/file");

		const failure = toPluginNetworkCapabilityError(diagnostic);

		expect(failure).toMatchObject({
			message: "Plugin network request failed",
			details: { reason: "internal-failure" },
			cause: diagnostic,
		});
	});
});
