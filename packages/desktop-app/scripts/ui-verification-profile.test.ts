import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProfileEnvironment,
  resolveProfileLayout,
  seedDebugProfile,
} from "./ui-verification-profile";

const temporaryPaths: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("UI verification profiles", () => {
  test("fresh runs never reuse their home while debug remains stable", () => {
    const root = temporaryDirectory("profiles");
    const shared = { workspaceId: "12345678", homeDirectory: root, runtimeRoot: join(root, "runtime") };
    const firstFresh = resolveProfileLayout({ ...shared, profile: "fresh", runId: "first" });
    const nextFresh = resolveProfileLayout({ ...shared, profile: "fresh", runId: "next" });
    const firstDebug = resolveProfileLayout({ ...shared, profile: "debug" });
    const nextDebug = resolveProfileLayout({ ...shared, profile: "debug" });

    expect(firstFresh.vettaHome).not.toBe(nextFresh.vettaHome);
    expect(firstDebug.vettaHome).toBe(nextDebug.vettaHome);
    expect(firstFresh.userDataDir).not.toBe(firstDebug.userDataDir);
  });

  test("dev is attach-only and points to the regular development home", () => {
    const root = temporaryDirectory("dev-profile");
    const layout = resolveProfileLayout({
      profile: "dev",
      workspaceId: "12345678",
      homeDirectory: root,
      runtimeRoot: join(root, "runtime"),
    });
    const environment = createProfileEnvironment(layout, { VETTA_UI_VERIFICATION: "stale" });

    expect(layout.statePath).toBeNull();
    expect(layout.vettaHome).toBe(join(root, ".vetta-dev"));
    expect(environment.VETTA_UI_VERIFICATION).toBeUndefined();
  });
});

describe("debug profile seeding", () => {
  test("copies models and only referenced encrypted model credentials", () => {
    const root = temporaryDirectory("seed");
    const sourceHome = join(root, "source");
    const targetHome = join(root, "target");
    const credentialDir = join(sourceHome, "desktop-app", "credentials");
    mkdirSync(join(sourceHome, "agent"), { recursive: true });
    mkdirSync(credentialDir, { recursive: true });
    writeJson(join(sourceHome, "agent", "models.json"), {
      providers: {
        openai: { credentialRef: "openai-ref", apiKey: "plaintext-secret" },
        local: { apiKey: "env:LOCAL_MODEL_KEY" },
		command: { apiKey: "cmd:read-secret" },
      },
    });
    writeJson(join(sourceHome, "desktop-config.json"), {
      projects: ["C:/private-project"],
      language: "zh",
      defaultExecutionMode: "sandbox",
		defaultAgentMode: "coding",
      quickPanel: { triggerMode: "hotkey" },
      knowledgeBase: { enabled: true },
    });
    writeCredential(credentialDir, "referenced", "models", "openai-ref", "secret-ciphertext");
    writeCredential(credentialDir, "unreferenced", "models", "other-ref", "other-secret");
    writeCredential(credentialDir, "unrelated", "mcp", "server-ref", "mcp-secret");
    writeJson(join(sourceHome, "action-server.json"), { token: "must-not-copy" });

    const result = seedDebugProfile({
      sourceHome,
      targetHome,
      workspacePath: "C:/workspace/vetta",
    });

    expect(result).toMatchObject({ seeded: true, modelsCopied: true, credentialsCopied: 1 });
    expect(JSON.stringify(result)).not.toContain("secret-ciphertext");
    expect(readJson(join(targetHome, "agent", "models.json"))).toMatchObject({
      providers: {
			openai: { credentialRef: "openai-ref" },
			local: { apiKey: "env:LOCAL_MODEL_KEY" },
			command: {},
		},
    });
		expect(readFileSync(join(targetHome, "agent", "models.json"), "utf8")).not.toContain(
			"plaintext-secret",
		);
    expect(readJson(join(targetHome, "desktop-app", "credentials", "referenced.credential.json")))
      .toMatchObject({ ciphertext: "secret-ciphertext" });
    expect(() => readFileSync(join(targetHome, "desktop-app", "credentials", "unrelated.credential.json")))
      .toThrow();
    expect(() => readFileSync(join(targetHome, "action-server.json"))).toThrow();

    const desktopConfig = readJson(join(targetHome, "desktop-config.json")) as Record<string, unknown>;
    expect(desktopConfig).toMatchObject({
      projects: [resolve("C:/workspace/vetta")],
      notificationsEnabled: false,
      debugMode: true,
      language: "zh",
      defaultExecutionMode: "sandbox",
		defaultAgentMode: "coding",
      knowledgeBase: { enabled: false },
      quickPanel: { trigger: "none", postSendBehavior: "foreground" },
      appshot: { enabled: false },
    });
    expect(JSON.stringify(desktopConfig)).not.toContain("private-project");
  });

  test("initial seeding preserves debug edits while sync refreshes model data only", () => {
    const root = temporaryDirectory("sync");
    const sourceHome = join(root, "source");
    const targetHome = join(root, "target");
    const sourceCredentialDir = join(sourceHome, "desktop-app", "credentials");
    mkdirSync(join(sourceHome, "agent"), { recursive: true });
    mkdirSync(sourceCredentialDir, { recursive: true });
    writeJson(join(sourceHome, "agent", "models.json"), {
      providers: { openai: { credentialRef: "ref-v1" } },
    });
    writeCredential(sourceCredentialDir, "v1", "models", "ref-v1", "cipher-v1");

    seedDebugProfile({ sourceHome, targetHome, workspacePath: "C:/workspace" });
    writeJson(join(targetHome, "desktop-config.json"), { marker: "debug-edit" });
    writeJson(join(sourceHome, "agent", "models.json"), {
      providers: { openai: { credentialRef: "ref-v2" } },
    });
    writeCredential(sourceCredentialDir, "v2", "models", "ref-v2", "cipher-v2");

    expect(seedDebugProfile({ sourceHome, targetHome, workspacePath: "C:/workspace" }).seeded)
      .toBe(false);
    const synced = seedDebugProfile({
      sourceHome,
      targetHome,
      workspacePath: "C:/workspace",
      sync: true,
    });

    expect(synced.credentialsCopied).toBe(1);
    expect(readJson(join(targetHome, "desktop-config.json"))).toEqual({ marker: "debug-edit" });
    expect(() => readFileSync(join(targetHome, "desktop-app", "credentials", "v1.credential.json")))
      .toThrow();
    expect(readJson(join(targetHome, "desktop-app", "credentials", "v2.credential.json")))
      .toMatchObject({ ciphertext: "cipher-v2" });
  });
});

function temporaryDirectory(name: string): string {
  const path = join(tmpdir(), `vetta-ui-profile-${name}-${crypto.randomUUID()}`);
  mkdirSync(path, { recursive: true });
  temporaryPaths.push(path);
  return path;
}

function writeCredential(
  directory: string,
  fileName: string,
  namespace: string,
  ownerId: string,
  ciphertext: string,
): void {
  writeJson(join(directory, `${fileName}.credential.json`), {
    schemaVersion: 1,
    ref: { namespace, ownerId, name: "api-key" },
    backend: "electron-safe-storage",
    ciphertext,
  });
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
