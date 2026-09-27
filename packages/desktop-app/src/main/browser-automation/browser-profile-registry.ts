import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserSessionProfile } from "@astravia/capability-sdk";
import type { BrowserProfilePort, SessionResources } from "./contracts.js";

const BROWSER_AUTOMATION_ROOT = ".astravia/browser-automation";

function rootDir(): string {
	return join(process.env.HOME ?? tmpdir(), BROWSER_AUTOMATION_ROOT);
}

export class BrowserProfileRegistry implements BrowserProfilePort {
	async prepareSession(input: {
		namespace: string;
		sessionId: string;
		source: "managed" | "attach";
		profile: BrowserSessionProfile;
		headed: boolean;
	}): Promise<SessionResources> {
		const isPersistent = input.profile.type === "persistent";
		const resources: SessionResources = {
			configPath: "",
			profileDir: undefined,
			namespace: input.namespace,
			sessionId: input.sessionId,
			source: input.source,
			profile: input.profile,
			headed: input.headed,
		};
		if (isPersistent) {
			const profileId = input.profile.type === "persistent" ? input.profile.id : "unknown";
			const profileDir = join(rootDir(), "profiles", input.namespace, profileId);
			await mkdir(profileDir, { recursive: true });
			resources.profileDir = profileDir;
			resources.configPath = join(profileDir, "config.json");
		} else {
			const sessionsRoot = join(rootDir(), "sessions");
			await mkdir(sessionsRoot, { recursive: true });
			const sessionDir = await mkdtemp(join(sessionsRoot, `${input.sessionId}-`));
			resources.configPath = join(sessionDir, "config.json");
			resources.profileDir = sessionDir;
		}
		await writeFile(
			resources.configPath,
			JSON.stringify({ sessionId: input.sessionId, namespace: input.namespace, headed: input.headed }, null, 2),
			"utf8",
		);
		return resources;
	}

	async releaseSession(resources: SessionResources): Promise<void> {
		if (resources.profile.type === "ephemeral" && resources.profileDir) {
			try {
				await rm(resources.profileDir, { recursive: true, force: true });
			} catch {
				// ephemeral 清理是尽力而为
			}
		}
		// persistent profile 保持不动，下次同 id 新建可 --restore
	}
}
