export const SPEECH_INPUT_ENABLED_ENV = "VETTA_SPEECH_INPUT_ENABLED";

export function resolveSpeechInputTargetTags(
	env = process.env,
	platform = process.platform,
	arch = process.arch,
) {
	const configured =
		env.VETTA_IM_GATEWAY_TARGET_PLATFORMS ?? env.VETTA_CLI_TARGET_PLATFORMS ?? env.VETTA_VENDOR_PLATFORM;
	return typeof configured === "string" && configured.trim().length > 0
		? configured
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean)
		: [`${platform}-${arch}`];
}

function parseConfiguredEnabled(env) {
	const configured = env[SPEECH_INPUT_ENABLED_ENV];
	if (configured === undefined) return true;
	const raw = configured.trim();
	if (raw === "true") return true;
	if (raw === "false") return false;
	throw new Error(`${SPEECH_INPUT_ENABLED_ENV} must be "true" or "false", received: ${raw}`);
}

export function resolveSpeechInputBuildConfig({
	env = process.env,
	platform = process.platform,
	arch = process.arch,
	platformTags = resolveSpeechInputTargetTags(env, platform, arch),
} = {}) {
	const configuredEnabled = parseConfiguredEnabled(env);
	const targetSupported = platformTags.includes("win32-x64");
	return {
		configuredEnabled,
		targetSupported,
		enabled: configuredEnabled && targetSupported,
		platformTags: [...platformTags],
	};
}
