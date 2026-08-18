import { resolve } from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import type { PluginOption } from "vite";

interface SentryBuildSetup {
	enabled: boolean;
	plugins: PluginOption[];
}

export function createSentryBuildSetup(env: Record<string, string>, outputDirectory: string): SentryBuildSetup {
	const authToken = readValue(env, "VETTA_SENTRY_AUTH_TOKEN");
	const org = readValue(env, "VETTA_SENTRY_ORG");
	const project = readValue(env, "VETTA_SENTRY_PROJECT");
	const release = readValue(env, "VETTA_SENTRY_RELEASE");
	if (!authToken || !org || !project || !release) return { enabled: false, plugins: [] };

	const outputGlob = resolve(process.cwd(), outputDirectory).replaceAll("\\", "/");
	return {
		enabled: true,
		plugins: [
			sentryVitePlugin({
				authToken,
				org,
				project,
				url: readValue(env, "VETTA_SENTRY_URL"),
				telemetry: false,
				release: {
					name: release,
					setCommits: false,
				},
				sourcemaps: {
					assets: [`${outputGlob}/**/*.js`, `${outputGlob}/**/*.js.map`],
					filesToDeleteAfterUpload: `${outputGlob}/**/*.map`,
				},
			}),
		],
	};
}

export function readValue(env: Record<string, string>, key: string): string | undefined {
	const value = (process.env[key] ?? env[key])?.trim();
	return value ? value : undefined;
}
