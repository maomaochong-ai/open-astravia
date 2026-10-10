import { describe, expect, it } from "vitest";
import {
	createClientFromEnv,
	createGitHubClient,
	ensureLabels,
	GitHubApiError,
	resolveGitHubToken,
	resolveRepository,
	syncLabels,
	upsertPullRequestComment,
} from "./github-rest.mjs";

/**
 * Minimal GitHub transport: routes are keyed by `METHOD /path`, unknown ones fail loudly.
 * Every request is recorded so a test can assert the JSON body that was actually sent — an
 * empty body is rejected by GitHub with an error that names neither the label nor the field.
 */
function createTransport(routes) {
	const calls = [];
	const fetchImpl = async (url, init = {}) => {
		const parsed = new URL(String(url));
		const method = (init.method ?? "GET").toUpperCase();
		const key = `${method} ${parsed.pathname}`;
		calls.push({
			key,
			url: parsed.toString(),
			query: parsed.search,
			headers: init.headers,
			body: init.body ? JSON.parse(init.body) : undefined,
		});
		const route = routes[key];
		if (route === undefined) throw new Error(`unexpected request: ${key}`);
		const result = typeof route === "function" ? route({ parsed, calls }) : route;
		const status = result.status ?? 200;
		return {
			status,
			ok: status < 400,
			text: async () => (result.body === undefined || status === 204 ? "" : JSON.stringify(result.body)),
		};
	};
	return { fetchImpl, calls };
}

function clientFor(routes, options = {}) {
	const transport = createTransport(routes);
	return {
		...transport,
		client: createGitHubClient({ token: "test-token", fetchImpl: transport.fetchImpl, ...options }),
	};
}

const LABELS = [
	{ name: "automerge", color: "0e8a16", description: "Squash-merge once every required check is green" },
	{ name: "do-not-merge", color: "b60205", description: "Keep this pull request open" },
];

describe("github rest client", () => {
	it("requires a fetch implementation", () => {
		expect(() => createGitHubClient({ fetchImpl: null })).toThrow(/fetch implementation/u);
	});

	it("sends the JSON body, the API headers and the bearer token", async () => {
		const { client, calls } = clientFor({
			"POST /repos/o/r/labels": { status: 201, body: { id: 1 } },
		});
		await client.post("/repos/o/r/labels", { json: LABELS[0] });
		expect(calls[0].body).toEqual(LABELS[0]);
		expect(calls[0].headers["content-type"]).toBe("application/json");
		expect(calls[0].headers.authorization).toBe("Bearer test-token");
		expect(calls[0].headers["x-github-api-version"]).toBe("2022-11-28");
	});

	it("omits the authorization header when no token is configured", async () => {
		const { client, calls } = clientFor({ "GET /repos/o/r": {} }, { token: undefined });
		await client.get("/repos/o/r");
		expect(calls[0].headers.authorization).toBeUndefined();
	});

	it("drops null and undefined query parameters", async () => {
		const { client, calls } = clientFor({ "GET /repos/o/r/pulls": {} });
		await client.get("/repos/o/r/pulls", { query: { state: "open", page: undefined, sort: null, per_page: 100 } });
		expect(calls[0].query).toBe("?state=open&per_page=100");
	});

	it("tolerates a status for one call only", async () => {
		const { client } = clientFor({
			"GET /repos/o/r/labels/automerge": { status: 404, body: { message: "Not Found" } },
			"GET /repos/o/r/labels/do-not-merge": { status: 404, body: { message: "Not Found" } },
		});
		const tolerated = await client.get("/repos/o/r/labels/automerge", { tolerate: [404] });
		expect(tolerated.status).toBe(404);
		await expect(client.get("/repos/o/r/labels/do-not-merge")).rejects.toThrow(GitHubApiError);
	});

	it("reports method, path, status and body on failure", async () => {
		const { client } = clientFor({
			"POST /repos/o/r/labels": { status: 422, body: { message: "Invalid request." } },
		});
		const error = await client.post("/repos/o/r/labels", { json: {} }).catch((thrown) => thrown);
		expect(error).toBeInstanceOf(GitHubApiError);
		expect(error.method).toBe("POST");
		expect(error.path).toBe("/repos/o/r/labels");
		expect(error.status).toBe(422);
		expect(error.body).toEqual({ message: "Invalid request." });
		expect(error.message).toContain("HTTP 422");
	});

	it("keeps a non-JSON error body as text", async () => {
		const client = createGitHubClient({
			token: "test-token",
			fetchImpl: async () => ({ status: 502, ok: false, text: async () => "bad gateway" }),
		});
		const error = await client.get("/repos/o/r").catch((thrown) => thrown);
		expect(error).toBeInstanceOf(GitHubApiError);
		expect(error.body).toBe("bad gateway");
	});
});

describe("github rest pagination", () => {
	const page = (parsed) => Number(parsed.searchParams.get("page"));
	const items = (count, offset = 0) => Array.from({ length: count }, (_value, index) => ({ id: offset + index }));

	it("collects every page until a short page arrives", async () => {
		const { client, calls } = clientFor({
			"GET /repos/o/r/pulls": ({ parsed }) => (page(parsed) === 1 ? { body: items(100) } : { body: items(2, 100) }),
		});
		const result = await client.paginate("/repos/o/r/pulls", { limit: 5 });
		expect(result.items).toHaveLength(102);
		expect(result.truncated).toBe(false);
		expect(calls).toHaveLength(2);
	});

	it("flags truncation once the page limit is reached", async () => {
		const { client } = clientFor({ "GET /repos/o/r/pulls": { body: items(100) } });
		const result = await client.paginate("/repos/o/r/pulls", { limit: 2 });
		expect(result.items).toHaveLength(200);
		expect(result.truncated).toBe(true);
	});

	it("returns a single non-array payload as one item", async () => {
		const { client } = clientFor({
			"GET /repos/o/r/commits/abc/check-runs": { body: { total_count: 1, check_runs: [items(1)[0]] } },
		});
		const result = await client.paginate("/repos/o/r/commits/abc/check-runs");
		expect(result.items).toHaveLength(1);
		expect(result.items[0].total_count).toBe(1);
		expect(result.truncated).toBe(false);
	});
});

describe("github rest environment", () => {
	it("prefers the automation token over the workflow token", () => {
		expect(resolveGitHubToken({ ASTRAVIA_AUTOMATION_TOKEN: "pat", GITHUB_TOKEN: "workflow" })).toBe("pat");
	});

	it("falls back to the workflow token", () => {
		expect(resolveGitHubToken({ GITHUB_TOKEN: "workflow" })).toBe("workflow");
	});

	it("fails when the token is required and missing but tolerates an optional one", () => {
		expect(() => resolveGitHubToken({})).toThrow(/ASTRAVIA_AUTOMATION_TOKEN/u);
		expect(resolveGitHubToken({}, { required: false })).toBeUndefined();
	});

	it("parses the repository slug and rejects a malformed one", () => {
		expect(resolveRepository({ GITHUB_REPOSITORY: "o/r" })).toEqual({ owner: "o", repo: "r" });
		expect(() => resolveRepository({ GITHUB_REPOSITORY: "o" })).toThrow(/owner\/repo/u);
		expect(() => resolveRepository({})).toThrow(/owner\/repo/u);
	});

	it("builds a client against the configured API url", async () => {
		const transport = createTransport({ "GET /api/v3/repos/o/r": {} });
		const client = createClientFromEnv(
			{ GITHUB_TOKEN: "workflow", GITHUB_API_URL: "https://ghe.test/api/v3" },
			{ fetchImpl: transport.fetchImpl },
		);
		await client.get("/repos/o/r");
		expect(transport.calls[0].url).toBe("https://ghe.test/api/v3/repos/o/r");
	});
});

describe("pull request comment upsert", () => {
	const marker = "<!-- astravia-pr-conventions -->";
	const call = { owner: "o", repo: "r", number: 42, marker, body: "## Conventions\n\nAll good." };

	it("creates the comment when the marker is absent", async () => {
		const { client, calls } = clientFor({
			"GET /repos/o/r/issues/42/comments": { body: [{ id: 7, body: "unrelated" }] },
			"POST /repos/o/r/issues/42/comments": { status: 201, body: { id: 99 } },
		});
		const result = await upsertPullRequestComment(client, call);
		expect(result).toEqual({ action: "created", id: 99 });
		const posted = calls.find((entry) => entry.key === "POST /repos/o/r/issues/42/comments");
		expect(posted.body).toEqual({ body: `${marker}\n${call.body}` });
	});

	it("updates the existing comment when the report changed", async () => {
		const { client, calls } = clientFor({
			"GET /repos/o/r/issues/42/comments": { body: [{ id: 7, body: `${marker}\nstale` }] },
			"PATCH /repos/o/r/issues/comments/7": { body: { id: 7 } },
		});
		const result = await upsertPullRequestComment(client, call);
		expect(result).toEqual({ action: "updated", id: 7 });
		const patched = calls.find((entry) => entry.key === "PATCH /repos/o/r/issues/comments/7");
		expect(patched.body).toEqual({ body: `${marker}\n${call.body}` });
	});

	it("leaves an up-to-date comment alone", async () => {
		const { client, calls } = clientFor({
			"GET /repos/o/r/issues/42/comments": { body: [{ id: 7, body: `${marker}\n${call.body}` }] },
		});
		const result = await upsertPullRequestComment(client, call);
		expect(result).toEqual({ action: "unchanged", id: 7 });
		expect(calls).toHaveLength(1);
	});
});

describe("label management", () => {
	it("creates a missing label with its name, colour and description", async () => {
		const { client, calls } = clientFor({
			"GET /repos/o/r/labels/automerge": { status: 404, body: { message: "Not Found" } },
			"POST /repos/o/r/labels": { status: 201, body: { name: "automerge" } },
		});
		const created = [];
		await ensureLabels(client, { owner: "o", repo: "r", labels: [LABELS[0]], log: (line) => created.push(line) });
		const posted = calls.find((entry) => entry.key === "POST /repos/o/r/labels");
		expect(posted.body).toEqual(LABELS[0]);
		expect(created).toEqual(["created label automerge"]);
	});

	it("skips a label that already exists", async () => {
		const { client, calls } = clientFor({
			"GET /repos/o/r/labels/automerge": { body: { name: "automerge" } },
		});
		await ensureLabels(client, { owner: "o", repo: "r", labels: [LABELS[0]] });
		expect(calls).toHaveLength(1);
	});

	it("encodes the label name in the lookup path", async () => {
		const label = { name: "quality:blocked", color: "d93f0b", description: "Unresolved items" };
		const { client, calls } = clientFor({
			"GET /repos/o/r/labels/quality%3Ablocked": { body: { name: label.name } },
		});
		await ensureLabels(client, { owner: "o", repo: "r", labels: [label] });
		expect(calls[0].key).toBe("GET /repos/o/r/labels/quality%3Ablocked");
	});

	it("adds the missing labels in one request and removes the stale ones", async () => {
		const { client, calls } = clientFor({
			"POST /repos/o/r/issues/42/labels": { body: [{ name: "automerge" }] },
			"DELETE /repos/o/r/issues/42/labels/quality%3Ablocked": { status: 204 },
		});
		const result = await syncLabels(client, {
			owner: "o",
			repo: "r",
			number: 42,
			current: ["quality:blocked"],
			add: ["automerge", "quality:blocked"],
			remove: ["quality:blocked", "quality:large"],
		});
		expect(result).toEqual({ added: ["automerge"], removed: ["quality:blocked"] });
		const posted = calls.find((entry) => entry.key === "POST /repos/o/r/issues/42/labels");
		expect(posted.body).toEqual({ labels: ["automerge"] });
	});

	it("does nothing when the labels already match", async () => {
		const { client, calls } = clientFor({});
		const result = await syncLabels(client, {
			owner: "o",
			repo: "r",
			number: 42,
			current: ["automerge"],
			add: ["automerge"],
			remove: ["quality:blocked"],
		});
		expect(result).toEqual({ added: [], removed: [] });
		expect(calls).toHaveLength(0);
	});

	it("tolerates a missing label when removing", async () => {
		const { client } = clientFor({
			"DELETE /repos/o/r/issues/42/labels/quality%3Alarge": { status: 404, body: { message: "Not Found" } },
		});
		const result = await syncLabels(client, {
			owner: "o",
			repo: "r",
			number: 42,
			current: ["quality:large"],
			add: [],
			remove: ["quality:large"],
		});
		expect(result).toEqual({ added: [], removed: ["quality:large"] });
	});
});
