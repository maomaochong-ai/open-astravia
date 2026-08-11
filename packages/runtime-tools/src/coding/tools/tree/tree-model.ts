import { isAbsolute, relative } from "node:path";

type TreeNodeType = "dir" | "file";

interface TreeNode {
	name: string;
	type: TreeNodeType;
	children: Map<string, TreeNode>;
}

interface RenderedTreeLine {
	line: string;
	relativePath: string;
	type: TreeNodeType;
}

export interface RenderTreeResult {
	readonly rawOutput: string;
	readonly nodeLimitReached: boolean;
	readonly totalNodesDiscovered: number;
	readonly nodesRendered: number;
}

function createNode(name: string, type: TreeNodeType): TreeNode {
	return { name, type, children: new Map() };
}

function addPath(root: TreeNode, relativePath: string, leafType: TreeNodeType): void {
	const segments = relativePath.split("/").filter(Boolean);
	if (segments.length === 0) return;

	let current = root;
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		const isLeaf = index === segments.length - 1;
		const nextType: TreeNodeType = isLeaf ? leafType : "dir";
		const existing = current.children.get(segment);
		if (!existing) {
			const created = createNode(segment, nextType);
			current.children.set(segment, created);
			current = created;
			continue;
		}
		if (existing.type === "file" && nextType === "dir") existing.type = "dir";
		current = existing;
	}
}

function countImmediateChildren(node: TreeNode): { readonly dirCount: number; readonly fileCount: number } {
	let dirCount = 0;
	let fileCount = 0;
	for (const child of node.children.values()) {
		if (child.type === "dir") dirCount += 1;
		else fileCount += 1;
	}
	return { dirCount, fileCount };
}

function formatNodeLine(node: TreeNode): string {
	if (node.type === "file") return `[F] ${node.name}`;
	const { dirCount, fileCount } = countImmediateChildren(node);
	return `[D] ${node.name} (d:${dirCount}, f:${fileCount})`;
}

function sortChildren(children: Iterable<TreeNode>): TreeNode[] {
	return Array.from(children).sort((left, right) => {
		if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
		return left.name.toLowerCase().localeCompare(right.name.toLowerCase());
	});
}

function renderTree(
	root: TreeNode,
	maxDepth: number,
	limit: number,
): { readonly lines: readonly RenderedTreeLine[]; readonly nodeLimitReached: boolean } {
	const lines: RenderedTreeLine[] = [];
	let nodeLimitReached = false;
	const tryPush = (line: RenderedTreeLine): boolean => {
		if (lines.length >= limit) {
			nodeLimitReached = true;
			return false;
		}
		lines.push(line);
		return true;
	};

	if (!tryPush({ line: formatNodeLine(root), relativePath: ".", type: "dir" })) {
		return { lines, nodeLimitReached };
	}

	const walk = (node: TreeNode, relativePath: string, prefix: string, depth: number): boolean => {
		if (depth >= maxDepth) return false;
		const children = sortChildren(node.children.values());
		for (let index = 0; index < children.length; index += 1) {
			const child = children[index];
			const isLast = index === children.length - 1;
			const childRelativePath = relativePath === "." ? child.name : `${relativePath}/${child.name}`;
			if (
				!tryPush({
					line: `${prefix}${isLast ? "└── " : "├── "}${formatNodeLine(child)}`,
					relativePath: childRelativePath,
					type: child.type,
				})
			) {
				return true;
			}
			if (child.type === "dir") {
				const shouldStop = walk(child, childRelativePath, `${prefix}${isLast ? "    " : "│   "}`, depth + 1);
				if (shouldStop) return true;
			}
		}
		return false;
	};

	walk(root, ".", "", 0);
	return { lines, nodeLimitReached };
}

export function buildFdArgs(
	type: TreeNodeType,
	searchPath: string,
	maxDepth: number,
	scanLimit: number,
	includeHidden: boolean,
	ignore: readonly string[],
): string[] {
	const args = [
		"--color=never",
		"--type",
		type === "dir" ? "d" : "f",
		"--max-depth",
		String(maxDepth),
		"--max-results",
		String(scanLimit),
	];
	if (includeHidden) args.push("--hidden");
	for (const pattern of ignore) args.push("--exclude", pattern);
	args.push(".", searchPath);
	return args;
}

export function parseFdOutput(stdout: string, searchPath: string): string[] {
	const paths: string[] = [];
	for (const rawLine of stdout.split("\n")) {
		const trimmed = rawLine.replace(/\r$/, "").trim();
		if (!trimmed) continue;
		let normalized = trimmed;
		if (isAbsolute(normalized) || normalized.startsWith(searchPath)) normalized = relative(searchPath, normalized);
		normalized = normalized
			.replace(/\\/g, "/")
			.replace(/^\.\/+/, "")
			.replace(/^\/+/, "")
			.replace(/\/+$/, "");
		if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) continue;
		paths.push(normalized);
	}
	return paths;
}

export function renderTreeOutput(
	rootLabel: string,
	directoryPaths: readonly string[],
	filePaths: readonly string[],
	maxDepth: number,
	limit: number,
): RenderTreeResult {
	const root = createNode(rootLabel, "dir");
	for (const directoryPath of directoryPaths) addPath(root, directoryPath, "dir");
	for (const filePath of filePaths) addPath(root, filePath, "file");
	const { lines, nodeLimitReached } = renderTree(root, maxDepth, limit);
	const renderedLines = lines.map((entry) => {
		if (entry.relativePath === ".") return entry.line;
		return `${entry.line} (type=${entry.type})`;
	});
	return {
		rawOutput: renderedLines.length > 0 ? renderedLines.join("\n") : `[D] ${rootLabel} (d:0, f:0)`,
		nodeLimitReached,
		totalNodesDiscovered: 1 + directoryPaths.length + filePaths.length,
		nodesRendered: lines.length,
	};
}
