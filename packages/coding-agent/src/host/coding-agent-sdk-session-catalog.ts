import type { SessionHistoryInfo } from "@vetta/runtime-core";
import { FileConversationRuntimeSessionCatalog } from "@vetta/runtime-storage/conversation";
import type {
	CodingAgentSessionCatalog,
	CodingAgentSessionSummary,
	CreateCodingAgentSessionCatalogOptions,
} from "../public-api/sdk/index.js";

class CodingAgentFileSessionCatalog implements CodingAgentSessionCatalog {
	private readonly catalog: FileConversationRuntimeSessionCatalog;
	private readonly cwd: string;
	private readonly conversationDir: string;

	constructor(options: CreateCodingAgentSessionCatalogOptions) {
		this.cwd = options.cwd ?? process.cwd();
		this.conversationDir = options.conversationDir;
		this.catalog = new FileConversationRuntimeSessionCatalog({
			roots: [{ cwd: this.cwd, sessionDir: this.conversationDir }],
		});
	}

	async list(): Promise<readonly CodingAgentSessionSummary[]> {
		const sessions = await this.catalog.listSessions(this.cwd, this.conversationDir);
		return sessions.map(projectSessionSummary);
	}

	async findRecent(): Promise<CodingAgentSessionSummary | undefined> {
		return (await this.list())[0];
	}
}

export function createCodingAgentSessionCatalogFromPublicOptions(
	options: CreateCodingAgentSessionCatalogOptions,
): CodingAgentSessionCatalog {
	return new CodingAgentFileSessionCatalog(options);
}

function projectSessionSummary(session: SessionHistoryInfo): CodingAgentSessionSummary {
	return {
		id: session.id,
		path: session.path,
		cwd: session.cwd,
		firstMessage: session.firstMessage,
		modifiedAt: session.modifiedAt,
		...(session.name === undefined ? {} : { name: session.name }),
		...(session.lastMessagePreview === undefined ? {} : { lastMessagePreview: session.lastMessagePreview }),
		...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
		...(session.parentEntryId === undefined ? {} : { parentEntryId: session.parentEntryId }),
	};
}
