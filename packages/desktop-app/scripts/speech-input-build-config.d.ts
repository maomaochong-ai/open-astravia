export const SPEECH_INPUT_ENABLED_ENV: "VETTA_SPEECH_INPUT_ENABLED";

export interface SpeechInputBuildConfig {
	configuredEnabled: boolean;
	targetSupported: boolean;
	enabled: boolean;
	platformTags: string[];
}

export interface ResolveSpeechInputBuildConfigOptions {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	arch?: string;
	platformTags?: readonly string[];
}

export function resolveSpeechInputTargetTags(
	env?: NodeJS.ProcessEnv,
	platform?: NodeJS.Platform,
	arch?: string,
): string[];

export function resolveSpeechInputBuildConfig(
	options?: ResolveSpeechInputBuildConfigOptions,
): SpeechInputBuildConfig;
