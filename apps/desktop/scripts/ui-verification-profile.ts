import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const UI_VERIFICATION_PROFILES = ["fresh", "debug", "dev"] as const;

export type UiVerificationProfile = (typeof UI_VERIFICATION_PROFILES)[number];

export interface UiVerificationProfileLayout {
  profile: UiVerificationProfile;
  workspaceId: string;
  sessionName: string;
  configDir: string;
  vettaHome: string;
  userDataDir: string;
  endpointFile: string;
  runtimeDir: string;
  statePath: string | null;
  artifactDir: string;
  logPath: string | null;
  runId: string | null;
}

export interface ResolveProfileLayoutOptions {
  profile: UiVerificationProfile;
  workspaceId: string;
  homeDirectory?: string;
  runtimeRoot?: string;
  runId?: string;
}

export interface SeedDebugProfileOptions {
  sourceHome: string;
  targetHome: string;
  workspacePath: string;
  sync?: boolean;
}

export interface SeedDebugProfileResult {
  seeded: boolean;
  modelsCopied: boolean;
  credentialsCopied: number;
  sourceHome: string;
  targetHome: string;
}

interface CredentialRecord {
  schemaVersion: number;
  ref: {
    namespace: string;
    ownerId: string;
    name: string;
  };
  ciphertext: string;
}

interface ModelConfig {
  providers?: Record<string, { credentialRef?: unknown; apiKey?: unknown; [key: string]: unknown }>;
	[key: string]: unknown;
}

const seedManifestName = ".ui-verification-seed.json";

export function createWorkspaceId(workspacePath: string): string {
  return createHash("sha256").update(resolve(workspacePath)).digest("hex").slice(0, 8);
}

export function parseUiVerificationProfile(value: string | undefined): UiVerificationProfile {
  const profile = value ?? "fresh";
  if (UI_VERIFICATION_PROFILES.includes(profile as UiVerificationProfile)) {
    return profile as UiVerificationProfile;
  }
  throw new Error(
    `Unknown UI verification profile: ${profile}. Expected one of ${UI_VERIFICATION_PROFILES.join(", ")}.`,
  );
}

export function resolveProfileLayout(
  options: ResolveProfileLayoutOptions,
): UiVerificationProfileLayout {
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const runtimeRoot = resolve(
    options.runtimeRoot ?? join(tmpdir(), "vetta-ui-verification", options.workspaceId),
  );
  const profileRuntimeDir = join(runtimeRoot, options.profile);

  if (options.profile === "dev") {
    const vettaHome = join(homeDirectory, ".vetta-dev");
    return {
      profile: options.profile,
      workspaceId: options.workspaceId,
      sessionName: `vetta-dev-${options.workspaceId}`,
      configDir: ".vetta-dev",
      vettaHome,
      userDataDir: join(vettaHome, "electron-user-data"),
      endpointFile: join(vettaHome, "action-server.json"),
      runtimeDir: profileRuntimeDir,
      statePath: null,
      artifactDir: join(runtimeRoot, "artifacts", "dev"),
      logPath: null,
      runId: null,
    };
  }

  const runId = options.profile === "fresh" ? options.runId ?? randomUUID() : null;
  const vettaHome =
    options.profile === "fresh"
      ? join(profileRuntimeDir, "runs", runId as string, "home")
      : join(homeDirectory, ".vetta-ui-debug", options.workspaceId);
  const configDir = `.vetta-ui-${options.profile}-${options.workspaceId}`;

  return {
    profile: options.profile,
    workspaceId: options.workspaceId,
    sessionName: `vetta-${options.profile}-${options.workspaceId}`,
    configDir,
    vettaHome,
    userDataDir: join(vettaHome, "electron-user-data"),
    endpointFile: join(profileRuntimeDir, "action-server.json"),
    runtimeDir: profileRuntimeDir,
    statePath: join(profileRuntimeDir, "host.json"),
    artifactDir: join(runtimeRoot, "artifacts", options.profile),
    logPath: join(profileRuntimeDir, "host.log"),
    runId,
  };
}

export function createProfileEnvironment(
  layout: UiVerificationProfileLayout,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const profileEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    VETTA_CONFIG_DIR: layout.configDir,
    VETTA_HOME: layout.vettaHome,
    VETTA_CODING_AGENT_DIR: join(layout.vettaHome, "agent"),
    VETTA_DESKTOP_USER_DATA_DIR: layout.userDataDir,
    VETTA_ACTION_RPC_ENDPOINT_FILE: layout.endpointFile,
    VETTA_THEME_DEV_SERVER: "0",
  };

  if (layout.profile !== "dev") {
    profileEnvironment.VETTA_UI_VERIFICATION = "1";
  } else {
    delete profileEnvironment.VETTA_UI_VERIFICATION;
  }

  return profileEnvironment;
}

export function seedDebugProfile(options: SeedDebugProfileOptions): SeedDebugProfileResult {
  const sourceHome = resolve(options.sourceHome);
  const targetHome = resolve(options.targetHome);
  const manifestPath = join(targetHome, seedManifestName);

  if (!options.sync && existsSync(manifestPath)) {
    return {
      seeded: false,
      modelsCopied: false,
      credentialsCopied: 0,
      sourceHome,
      targetHome,
    };
  }

  mkdirSync(targetHome, { recursive: true });
  const modelsResult = copyModelConfiguration({
    sourceHome,
    targetHome,
    replaceExistingCredentials: options.sync === true,
  });

  if (!options.sync) {
    writeSafeDesktopConfiguration(sourceHome, targetHome, resolve(options.workspacePath));
  }

  writeJsonAtomic(manifestPath, {
    schemaVersion: 1,
    sourceHome,
    seededAt: new Date().toISOString(),
    modelsCopied: modelsResult.modelsCopied,
    credentialsCopied: modelsResult.credentialsCopied,
  });

  return {
    seeded: true,
    ...modelsResult,
    sourceHome,
    targetHome,
  };
}

function copyModelConfiguration(options: {
  sourceHome: string;
  targetHome: string;
  replaceExistingCredentials: boolean;
}): { modelsCopied: boolean; credentialsCopied: number } {
  const sourceModelsPath = join(options.sourceHome, "agent", "models.json");
  if (!existsSync(sourceModelsPath)) {
    return { modelsCopied: false, credentialsCopied: 0 };
  }

  const modelConfig = readJson<ModelConfig>(sourceModelsPath);
  const credentialRefs = new Set<string>();
  for (const provider of Object.values(modelConfig.providers ?? {})) {
    if (typeof provider.credentialRef === "string" && provider.credentialRef.length > 0) {
      credentialRefs.add(provider.credentialRef);
    }
  }

  const targetModelsPath = join(options.targetHome, "agent", "models.json");
  writeJsonAtomic(targetModelsPath, sanitizeModelConfiguration(modelConfig));

  const sourceCredentialDir = join(options.sourceHome, "desktop-app", "credentials");
  const targetCredentialDir = join(options.targetHome, "desktop-app", "credentials");
  mkdirSync(targetCredentialDir, { recursive: true });

  if (options.replaceExistingCredentials) {
    removeModelCredentials(targetCredentialDir);
  }

  let credentialsCopied = 0;
  if (existsSync(sourceCredentialDir)) {
    for (const entry of readdirSync(sourceCredentialDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".credential.json")) {
        continue;
      }
      const sourcePath = join(sourceCredentialDir, entry.name);
      const record = tryReadCredentialRecord(sourcePath);
      if (
        record?.ref.namespace !== "models" ||
        record.ref.name !== "api-key" ||
        !credentialRefs.has(record.ref.ownerId)
      ) {
        continue;
      }
      copyFileAtomic(sourcePath, join(targetCredentialDir, entry.name));
      credentialsCopied += 1;
    }
  }

  return { modelsCopied: true, credentialsCopied };
}

function sanitizeModelConfiguration(modelConfig: ModelConfig): ModelConfig {
	const sanitized = structuredClone(modelConfig);
	for (const provider of Object.values(sanitized.providers ?? {})) {
		if (typeof provider.apiKey !== "string" || !isEnvironmentReference(provider.apiKey)) {
			delete provider.apiKey;
		}
	}
	return sanitized;
}

function isEnvironmentReference(value: string): boolean {
	const trimmed = value.trim();
	return /^env:[A-Z_][A-Z0-9_]*$/i.test(trimmed) || /^[A-Z_][A-Z0-9_]*$/.test(trimmed);
}

function removeModelCredentials(targetCredentialDir: string): void {
  if (!existsSync(targetCredentialDir)) {
    return;
  }
  for (const entry of readdirSync(targetCredentialDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".credential.json")) {
      continue;
    }
    const targetPath = join(targetCredentialDir, entry.name);
    if (tryReadCredentialRecord(targetPath)?.ref.namespace === "models") {
      rmSync(targetPath, { force: true });
    }
  }
}

function tryReadCredentialRecord(path: string): CredentialRecord | null {
  try {
    const value = readJson<unknown>(path);
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.ref)) {
      return null;
    }
    if (
      typeof value.ref.namespace !== "string" ||
      typeof value.ref.ownerId !== "string" ||
      typeof value.ref.name !== "string" ||
      typeof value.ciphertext !== "string"
    ) {
      return null;
    }
    return value as unknown as CredentialRecord;
  } catch {
    return null;
  }
}

function writeSafeDesktopConfiguration(
  sourceHome: string,
  targetHome: string,
  workspacePath: string,
): void {
  const targetPath = join(targetHome, "desktop-config.json");
  if (existsSync(targetPath)) {
    return;
  }

  const sourcePath = join(sourceHome, "desktop-config.json");
  let source: Record<string, unknown> = {};
  if (existsSync(sourcePath)) {
    const parsed = readJson<unknown>(sourcePath);
    if (isRecord(parsed)) {
      source = parsed;
    }
  }

  const config: Record<string, unknown> = {
    projects: [workspacePath],
    archivedProjects: [],
    workspacePath: join(targetHome, "workspace"),
    notificationsEnabled: false,
    debugMode: true,
    knowledgeBase: { enabled: false },
    quickPanel: { trigger: "none", postSendBehavior: "foreground" },
    appshot: { enabled: false },
  };

  copyEnum(source, config, "language", ["system", "zh", "en"]);
  copyEnum(source, config, "defaultExecutionMode", ["sandbox", "full-access"]);
  copyEnum(source, config, "defaultAgentMode", ["work", "coding"]);

  writeJsonAtomic(targetPath, config);
}

function copyEnum(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): void {
  const value = source[key];
  if (typeof value === "string" && allowed.includes(value)) {
    target[key] = value;
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function copyFileAtomic(sourcePath: string, targetPath: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  copyFileSync(sourcePath, temporaryPath);
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, targetPath);
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
