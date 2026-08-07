import { useCallback, useMemo, useState } from "react";
import { useActiveConversation } from "@vetta-org/plugin-sdk";
import { getPluginCtx } from "./plugin-context";
import { ALL_PROBES, runAllProbes, summarizeResults, type ProbeResult, type ProbeStatus } from "./probes";

const STATUS_LABEL: Record<ProbeStatus, string> = {
	pass: "通过",
	blocked: "已拦截",
	finding: "发现",
	skip: "跳过",
	error: "错误",
};

const STATUS_CLASS: Record<ProbeStatus, string> = {
	pass: "bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] text-[var(--primary)]",
	blocked: "bg-[color-mix(in_srgb,var(--muted)_70%,transparent)] text-[var(--muted-foreground)]",
	finding: "bg-[color-mix(in_srgb,#ef4444_20%,transparent)] text-[#ef4444]",
	skip: "bg-[color-mix(in_srgb,var(--accent)_70%,transparent)] text-[var(--muted-foreground)]",
	error: "bg-[color-mix(in_srgb,#f59e0b_22%,transparent)] text-[#d97706]",
};

function StatusBadge({ status }: { status: ProbeStatus }) {
	return (
		<span className={`rounded-full px-[8px] py-[2px] text-[11px] font-semibold ${STATUS_CLASS[status]}`}>
			{STATUS_LABEL[status]}
		</span>
	);
}

function ResultCard({ result }: { result: ProbeResult }) {
	const [open, setOpen] = useState(result.status === "finding" || result.status === "error");
	return (
		<article className="rounded-[10px] border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--muted)_35%,transparent)] p-[10px]">
			<button
				type="button"
				className="flex w-full cursor-pointer items-start justify-between gap-[10px] border-0 bg-transparent p-0 text-left"
				onClick={() => setOpen((value) => !value)}
			>
				<div className="min-w-0">
					<p className="text-[11px] font-semibold tracking-[0.04em] text-[var(--muted-foreground)] uppercase">
						{result.category}
					</p>
					<h3 className="mt-[2px] text-[13px] font-semibold text-[var(--foreground)]">{result.title}</h3>
					<p className="mt-[4px] text-[12px] leading-[1.4] text-[var(--muted-foreground)]">{result.summary}</p>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-[6px]">
					<StatusBadge status={result.status} />
					<span className="text-[10px] text-[var(--muted-foreground)]">{result.durationMs}ms</span>
				</div>
			</button>
			{open && result.detail ? (
				<pre className="mt-[8px] max-h-[220px] overflow-auto rounded-[8px] border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-[color-mix(in_srgb,var(--background)_80%,transparent)] p-[8px] text-[11px] leading-[1.4] break-all whitespace-pre-wrap text-[var(--muted-foreground)]">
					{result.detail}
				</pre>
			) : null}
		</article>
	);
}

export function ProbePanel({ compact = false }: { compact?: boolean }) {
	const conversation = useActiveConversation();
	const [running, setRunning] = useState(false);
	const [results, setResults] = useState<ProbeResult[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<"all" | ProbeStatus>("all");

	const projectRoot = conversation.cwd;

	const summary = useMemo(() => (results ? summarizeResults(results) : null), [results]);

	const filtered = useMemo(() => {
		if (!results) return [];
		if (filter === "all") return results;
		return results.filter((result) => result.status === filter);
	}, [results, filter]);

	const run = useCallback(async () => {
		setRunning(true);
		setError(null);
		try {
			const ctx = getPluginCtx();
			const probeToken = crypto.randomUUID().slice(0, 8);
			const next = await runAllProbes({
				ctx,
				projectRoot,
				probeToken,
			});
			setResults(next);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRunning(false);
		}
	}, [projectRoot]);

	const exportJson = useCallback(() => {
		if (!results) return;
		const payload = {
			generatedAt: new Date().toISOString(),
			plugin: getPluginCtx().plugin,
			projectRoot,
			summary: summarizeResults(results),
			results,
			probeCatalog: ALL_PROBES.map((probe) => ({
				id: probe.id,
				category: probe.category,
				title: probe.title,
			})),
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `security-probe-${Date.now()}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}, [projectRoot, results]);

	return (
		<section
			className={`flex h-full min-h-0 flex-col font-[var(--font-sans)] text-[var(--foreground)] ${compact ? "" : "p-[12px]"}`}
			aria-label="Security probe panel"
		>
			<header className="mb-[10px] shrink-0">
				<p className="mb-[2px] text-[11px] font-bold tracking-[0.08em] text-[var(--primary)] uppercase">
					Security Probe
				</p>
				<h2 className="text-[15px] font-bold">插件系统安全探针</h2>
				<p className="mt-[6px] text-[12px] leading-[1.45] text-[var(--muted-foreground)]">
					按 ADR-0023，插件与宿主同 renderer、无沙箱。本工具探测权限门控、路径/存储隔离、官方 API
					边界与 <code className="text-[11px]">window.vetta</code> 暴露面。默认不破坏用户数据；写探测仅触及
					plugin storage 或预期应失败的路径。
				</p>
				<p className="mt-[4px] text-[11px] text-[var(--muted-foreground)]">
					活动项目: {projectRoot ?? "（无 — 部分 FS 探测会跳过）"}
				</p>
			</header>

			<div className="mb-[10px] flex shrink-0 flex-wrap items-center gap-[8px]">
				<button
					type="button"
					disabled={running}
					className="cursor-pointer rounded-[8px] border border-transparent bg-[var(--primary)] px-[12px] py-[6px] text-[13px] font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
					onClick={() => void run()}
				>
					{running ? "探测中…" : "运行全部探测"}
				</button>
				<button
					type="button"
					disabled={!results}
					className="cursor-pointer rounded-[8px] border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[var(--accent)] px-[10px] py-[6px] text-[12px] font-semibold text-[var(--foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={exportJson}
				>
					导出 JSON
				</button>
				{summary ? (
					<div className="flex flex-wrap gap-[6px] text-[11px] text-[var(--muted-foreground)]">
						<span>通过 {summary.counts.pass}</span>
						<span>拦截 {summary.counts.blocked}</span>
						<span className="font-semibold text-[#ef4444]">发现 {summary.counts.finding}</span>
						<span>跳过 {summary.counts.skip}</span>
						<span>错误 {summary.counts.error}</span>
						{(summary.critical > 0 || summary.high > 0) && (
							<span className="font-semibold text-[#ef4444]">
								critical {summary.critical} / high {summary.high}
							</span>
						)}
					</div>
				) : null}
			</div>

			{error ? (
				<p className="mb-[8px] rounded-[8px] border border-[#ef4444]/40 bg-[color-mix(in_srgb,#ef4444_12%,transparent)] px-[8px] py-[6px] text-[12px] text-[#ef4444]">
					{error}
				</p>
			) : null}

			{results ? (
				<div className="mb-[8px] flex shrink-0 flex-wrap gap-[6px]">
					{(["all", "finding", "blocked", "pass", "skip", "error"] as const).map((key) => (
						<button
							key={key}
							type="button"
							className={`cursor-pointer rounded-full border px-[8px] py-[3px] text-[11px] font-semibold ${
								filter === key
									? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[var(--primary)]"
									: "border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-transparent text-[var(--muted-foreground)]"
							}`}
							onClick={() => setFilter(key)}
						>
							{key === "all" ? "全部" : STATUS_LABEL[key]}
						</button>
					))}
				</div>
			) : null}

			<div className="min-h-0 flex-1 space-y-[8px] overflow-auto pr-[2px]">
				{!results && !running ? (
					<div className="rounded-[10px] border border-dashed border-[color-mix(in_srgb,var(--border)_70%,transparent)] p-[14px] text-[12px] leading-[1.5] text-[var(--muted-foreground)]">
						<p className="mb-[6px] font-semibold text-[var(--foreground)]">建议测试路径</p>
						<ol className="list-decimal space-y-[4px] pl-[18px]">
							<li>仅授予 UI 权限，运行一次 — 验证各 API deny 路径。</li>
							<li>逐步授予 fs / storage / network / command，观察边界探测结果。</li>
							<li>重点查看标记为「发现」的项：同 renderer 暴露、window.vetta 旁路、homedir 读、SSRF。</li>
						</ol>
					</div>
				) : null}
				{filtered.map((result) => (
					<ResultCard key={result.id} result={result} />
				))}
			</div>
		</section>
	);
}
