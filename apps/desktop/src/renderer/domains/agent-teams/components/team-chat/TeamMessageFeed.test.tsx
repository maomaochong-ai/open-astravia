// @vitest-environment jsdom

import type { AgentTeamDocument, TeamDefinition, TeamSessionDocument } from "@vetta/agent-team";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamMessageFeed } from "./TeamMessageFeed";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-virtuoso", () => ({
	Virtuoso: ({ data, itemContent }: { data: readonly unknown[]; itemContent: (index: number, item: unknown) => ReactNode }) => (
		<div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>
	),
}));
vi.mock("@vetta/theme-ui/chat", () => ({ VirtuosoListContainer: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@domains/chat/components/blocks/TextBlock", () => ({
	MarkdownContent: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

afterEach(cleanup);

const team: TeamDefinition = {
	id: "team",
	revision: 1,
	name: "Team",
	description: "",
	leaderMemberId: "leader",
	members: [{ id: "leader", handle: "vetta", binding: { kind: "reference", agentProfileId: "leader-profile" } }],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 1,
	updatedAt: 1,
};

const document: AgentTeamDocument = { schemaVersion: 1, revision: 1, agents: [], teams: [team] };
const session: TeamSessionDocument = {
	schemaVersion: 1,
	revision: 1,
	id: "session",
	teamId: "team",
	name: "Team",
	cwd: "C:/workspace",
	leaderMemberId: "leader",
	memberHandles: { leader: "vetta" },
	createdAt: 1,
	updatedAt: 1,
	events: [{ type: "user-message", id: "message", requestId: "request", text: "hello", targetMemberIds: [], timestamp: 1 }],
	memberRuntime: {},
};

describe("TeamMessageFeed", () => {
	it("renders accumulated streaming text while the member is pending", () => {
		render(
			<TeamMessageFeed
				document={document}
				team={team}
				session={session}
				streamingByMember={{ leader: "partial response" }}
				pendingText="hello"
				sending
			/>,
		);

		expect(screen.getByText("partial response")).toBeTruthy();
	});
});
