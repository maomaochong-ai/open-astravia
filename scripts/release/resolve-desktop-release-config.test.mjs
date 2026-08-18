import { describe, expect, it } from "vitest";
import {
	firstExplicit,
	replaceLastPathSegment,
	resolveDesktopReleaseConfig,
	toGithubEnv,
	toGithubOutput,
} from "./resolve-desktop-release-config.mjs";

describe("firstExplicit", () => {
	it("skips empty, default, and whitespace tokens", () => {
		expect(firstExplicit("", "default", "  ", "true")).toBe("true");
	});
});

describe("replaceLastPathSegment", () => {
	it("rewrites a URL channel segment", () => {
		expect(replaceLastPathSegment("https://releases.example.com/desktop/stable", "test")).toBe(
			"https://releases.example.com/desktop/test",
		);
	});

	it("rewrites a plain prefix", () => {
		expect(replaceLastPathSegment("desktop/stable", "test")).toBe("desktop/test");
	});

	it("leaves unrelated paths alone", () => {
		expect(replaceLastPathSegment("desktop/artifacts", "test")).toBe("desktop/artifacts");
	});
});

describe("resolveDesktopReleaseConfig", () => {
	it("defaults a fork-style tag run to lite + GitHub Releases", () => {
		expect(resolveDesktopReleaseConfig({ eventName: "push", vars: {} })).toMatchObject({
			channel: "default",
			cloudEnabled: "",
			releaseTarget: "github",
			updateProvider: "github",
			serverUrl: "",
		});
	});

	it("uses Environment/repo vars on a tag and ignores leftover form inputs", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "push",
			inputs: { cloud_enabled: "false", server_url: "https://evil.example" },
			vars: {
				VETTA_CLOUD_ENABLED: "true",
				VETTA_RELEASE_TARGET: "r2",
				VETTA_SERVER_URL: "https://api.example.com/api/v1",
				VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable",
			},
		});
		expect(config).toMatchObject({
			cloudEnabled: "true",
			releaseTarget: "r2",
			serverUrl: "https://api.example.com/api/v1",
			updateProvider: "generic",
			updateUrl: "https://releases.example.com/desktop/stable",
		});
	});

	it("lets workflow_dispatch inputs override vars", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: {
				channel: "test",
				cloud_enabled: "true",
				server_url: "https://api.staging.example.com/api/v1",
			},
			vars: {
				VETTA_CLOUD_ENABLED: "true",
				VETTA_R2_PREFIX: "desktop/stable",
				VETTA_SERVER_URL: "https://api.example.com/api/v1",
				VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable",
			},
		});
		expect(config.serverUrl).toBe("https://api.staging.example.com/api/v1");
		expect(config.updateUrl).toBe("https://releases.example.com/desktop/test");
		expect(config.r2Prefix).toBe("desktop/test");
	});

	it("prefers dedicated test vars over last-segment rewrite", () => {
		const config = resolveDesktopReleaseConfig({
			eventName: "workflow_dispatch",
			inputs: { channel: "test" },
			vars: {
				VETTA_R2_PREFIX: "desktop/stable",
				VETTA_R2_PREFIX_TEST: "desktop/nightly",
				VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable",
				VETTA_UPDATE_URL_TEST: "https://releases.example.com/desktop/nightly",
			},
		});
		expect(config.updateUrl).toBe("https://releases.example.com/desktop/nightly");
		expect(config.r2Prefix).toBe("desktop/nightly");
	});

	it("rejects a full build without a server URL", () => {
		expect(() =>
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { cloud_enabled: "true" },
				vars: {},
			}),
		).toThrow(/VETTA_SERVER_URL/);
	});

	it("omits empty optional keys from GITHUB_ENV", () => {
		const env = toGithubEnv(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "r2" },
				vars: { VETTA_UPDATE_URL: "https://releases.example.com/desktop/stable" },
			}),
		);
		expect(env).toContain("VETTA_UPDATE_PROVIDER=generic");
		expect(env).toContain("VETTA_UPDATE_URL=https://releases.example.com/desktop/stable");
		expect(env).not.toContain("VETTA_CLOUD_ENABLED=");
		expect(env).not.toContain("VETTA_TENANT=");
	});

	it("writes GitHub output lines for the workflow", () => {
		const output = toGithubOutput(
			resolveDesktopReleaseConfig({
				eventName: "workflow_dispatch",
				inputs: { release_target: "github", notes: "rehearsal" },
			}),
		);
		expect(output).toContain("release_target=github");
		expect(output).toContain("notes=rehearsal");
		expect(output).toContain("update_provider=github");
	});
});
