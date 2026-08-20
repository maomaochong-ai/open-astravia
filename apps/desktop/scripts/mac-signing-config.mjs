export const MAC_SIGNING_ENV_KEYS = [
	"CSC_LINK",
	"CSC_NAME",
	"CSC_KEY_PASSWORD",
	"APPLE_TEAM_ID",
	"APPLE_ID",
	"APPLE_APP_SPECIFIC_PASSWORD",
	"APPLE_API_KEY",
	"APPLE_API_KEY_ID",
	"APPLE_API_ISSUER",
];

function hasValue(env, key) {
	return typeof env[key] === "string" && env[key].trim().length > 0;
}

export function hasMacSigningEnvironment(env = process.env) {
	return MAC_SIGNING_ENV_KEYS.some((key) => hasValue(env, key));
}

export function resolveMacSigningConfig(env = process.env) {
	const skipNotarizeValue = env.VETTA_SKIP_NOTARIZE?.trim();
	if (skipNotarizeValue && skipNotarizeValue !== "0" && skipNotarizeValue !== "1") {
		throw new Error('VETTA_SKIP_NOTARIZE must be "0" or "1"');
	}

	if (!hasMacSigningEnvironment(env)) {
		if (skipNotarizeValue === "1") {
			throw new Error("VETTA_SKIP_NOTARIZE=1 requires macOS signing credentials");
		}
		return { enabled: false };
	}

	const skipNotarize = skipNotarizeValue === "1";
	const missing = [];
	if (!hasValue(env, "CSC_LINK") && !hasValue(env, "CSC_NAME")) {
		missing.push("CSC_LINK or CSC_NAME");
	}
	if (!hasValue(env, "APPLE_TEAM_ID")) missing.push("APPLE_TEAM_ID");
	if (!skipNotarize) {
		const hasApiKey =
			hasValue(env, "APPLE_API_KEY") &&
			hasValue(env, "APPLE_API_KEY_ID") &&
			hasValue(env, "APPLE_API_ISSUER");
		const hasAppleId =
			hasValue(env, "APPLE_ID") && hasValue(env, "APPLE_APP_SPECIFIC_PASSWORD");
		if (!hasApiKey && !hasAppleId) {
			missing.push(
				"APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD",
			);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`macOS signing credentials are incomplete; missing: ${missing.join("; ")}. ` +
				"See docs/deploy/apple-code-signing.md, or clear all CSC_* and APPLE_* variables for an unsigned build.",
		);
	}

	return {
		enabled: true,
		notarize: !skipNotarize,
		teamId: env.APPLE_TEAM_ID.trim(),
	};
}
