/**
 * Minimal GitHub REST client for the contributor automation scripts.
 *
 * Every workflow that uses it runs checked-out base-branch code with a token,
 * never pull-request code, so the transport stays a plain `fetch` that tests can
 * replace. There is no Octokit dependency here on purpose: the automation only
 * needs a handful of endpoints, and an injectable transport keeps the decision
 * logic testable without a network.
 */

export class GitHubApiError extends Error {
	constructor(method, path, status, body) {
		super(`${method} ${path} failed with HTTP ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
		this.name = "GitHubApiError";
		this.method = method;
		this.path = path;
		this.status = status;
		this.body = body;
	}
}

export function createGitHubClient({
	token,
	apiUrl = "https://api.github.com",
	fetchImpl = globalThis.fetch,
	userAgent = "astravia-contributor-automation",
	tolerate = [],
} = {}) {
	if (typeof fetchImpl !== "function") throw new Error("createGitHubClient requires a fetch implementation");
	const base = apiUrl.replace(/\/+$/, "");
	const tolerated = new Set(tolerate);

	async function request(method, path, { body, query, tolerate: extra } = {}) {
		const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
		for (const [key, value] of Object.entries(query ?? {})) {
			if (value === undefined || value === null) continue;
			url.searchParams.set(key, String(value));
		}
		const headers = {
			accept: "application/vnd.github+json",
			"content-type": "application/json",
			"user-agent": userAgent,
			"x-github-api-version": "2022-11-28",
		};
		if (token) headers.authorization = `Bearer ${token}`;
		const init = { method, headers };
		if (body !== undefined) init.body = JSON.stringify(body);
		const response = await fetchImpl(url.toString(), init);
		const text = await response.text();
		let data;
		if (text.length > 0) {
			try {
				data = JSON.parse(text);
			} catch {
				data = text;
			}
		}
		const extraStatuses = new Set(extra ?? []);
		if (response.status >= 400 && !tolerated.has(response.status) && !extraStatuses.has(response.status)) {
			throw new GitHubApiError(method, url.pathname, response.status, data);
		}
		return { status: response.status, data, ok: response.ok };
	}

	async function paginate(path, { query, limit = 10 } = {}) {
		const items = [];
		for (let page = 1; page <= limit; page += 1) {
			const { data } = await request("GET", path, { query: { ...query, per_page: 100, page } });
			if (!Array.isArray(data)) {
				if (data !== undefined && data !== null) items.push(data);
				return { items, truncated: false };
			}
			items.push(...data);
			if (data.length < 100) return { items, truncated: false };
		}
		return { items, truncated: true };
	}

	return {
		request,
		get: (path, options) => request("GET", path, options),
		post: (path, options) => request("POST", path, options),
		put: (path, options) => request("PUT", path, options),
		patch: (path, options) => request("PATCH", path, options),
		del: (path, options) => request("DELETE", path, options),
		paginate,
	};
}

export function resolveGitHubToken(env = process.env, { required = true } = {}) {
	// A personal access token (or GitHub App token) is optional but recommended:
	// merges made with the default GITHUB_TOKEN do not start new workflow runs.
	const token = env.ASTRAVIA_AUTOMATION_TOKEN || env.GITHUB_TOKEN;
	if (!token && required) throw new Error("Missing ASTRAVIA_AUTOMATION_TOKEN or GITHUB_TOKEN");
	return token;
}

export function resolveRepository(env = process.env) {
	const slug = env.GITHUB_REPOSITORY;
	if (!slug || !slug.includes("/")) throw new Error(`GITHUB_REPOSITORY must look like owner/repo, got ${slug ?? ""}`);
	const [owner, repo] = slug.split("/");
	return { owner, repo };
}

export function createClientFromEnv(env = process.env, options = {}) {
	const token = resolveGitHubToken(env, options);
	return createGitHubClient({
		token,
		apiUrl: env.GITHUB_API_URL || "https://api.github.com",
		fetchImpl: options.fetchImpl,
		userAgent: options.userAgent,
	});
}

/**
 * Keep a single machine-owned comment per pull request in sync, so repeated runs
 * edit the existing comment instead of appending noise.
 */
export async function upsertPullRequestComment(client, { owner, repo, number, marker, body, log }) {
	const text = `${marker}\n${body}`;
	const { items } = await client.paginate(`/repos/${owner}/${repo}/issues/${number}/comments`, { limit: 5 });
	const existing = items.find((comment) => typeof comment?.body === "string" && comment.body.includes(marker));
	if (existing) {
		if (existing.body === text) {
			log?.(`comment #${existing.id} is already up to date`);
			return { action: "unchanged", id: existing.id };
		}
		await client.patch(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, { body: text });
		log?.(`updated comment #${existing.id}`);
		return { action: "updated", id: existing.id };
	}
	const { data } = await client.post(`/repos/${owner}/${repo}/issues/${number}/comments`, { body: text });
	log?.(`created comment #${data?.id ?? "?"}`);
	return { action: "created", id: data?.id };
}

export async function ensureLabels(client, { owner, repo, labels, log }) {
	for (const label of labels) {
		const { status } = await client.get(`/repos/${owner}/${repo}/labels/${encodeURIComponent(label.name)}`, {
			tolerate: [404],
		});
		if (status !== 404) continue;
		await client.post(`/repos/${owner}/${repo}/labels`, {
			name: label.name,
			color: label.color,
			description: label.description,
		});
		log?.(`created label ${label.name}`);
	}
}

export async function syncLabels(client, { owner, repo, number, current, add, remove, log }) {
	const present = new Set(current);
	const missing = add.filter((name) => !present.has(name));
	if (missing.length > 0) {
		await client.post(`/repos/${owner}/${repo}/issues/${number}/labels`, { labels: missing });
		log?.(`added labels ${missing.join(", ")}`);
	}
	const stale = remove.filter((name) => present.has(name));
	for (const name of stale) {
		await client.del(`/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(name)}`, {
			tolerate: [404],
		});
	}
	if (stale.length > 0) log?.(`removed labels ${stale.join(", ")}`);
	return { added: missing, removed: stale };
}
