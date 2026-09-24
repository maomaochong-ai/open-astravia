import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import type { MarkdownDefinition } from "@vetta-org/theme-ui/markdown";

const fixtures = {
	prose: "A paragraph with **emphasis**, `inline code`, and enough words to represent a long answer.\n\n".repeat(350),
	table: `| Name | Description | Value |\n| --- | --- | ---: |\n${Array.from({ length: 350 }, (_, i) => `| Item ${i} | A detailed description of this record | ${i} |\n`).join("")}`,
	code: `\`\`\`ts\n${Array.from({ length: 1200 }, (_, i) => `const item${i} = { value: ${i}, label: "example" };\n`).join("")}`,
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Production React profiling build; measures the real Markdown recipe, without a Desktop instance. */
export async function runMarkdownBenchmark() {
	const results = [];
	for (const [name, initial] of Object.entries(fixtures)) {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		let parseRuns = 0;
		let parsedCharacters = 0;
		const durations: number[] = [];
		const definition: MarkdownDefinition = {
			remarkPlugins: [() => (_tree, file) => {
				parseRuns++;
				parsedCharacters += String(file.value).length;
			}],
		};
		const render = (text: string, live: boolean) => root.render(
			<Profiler id="markdown" onRender={(_id, _phase, duration) => durations.push(duration)}>
				<MarkdownContent
					definition={definition}
					text={text}
					isStreamingTail={live}
					theme="light"
					labels={{ copy: "Copy", copied: "Copied" }}
					getFileIconClass={() => ""}
					onOpenFile={() => {}}
					onOpenUrl={() => {}}
				/>
			</Profiler>,
		);
		try {
			render(initial, true);
			// Warm mount, lazy chunks and reveal before measuring the append workload.
			await pause(1000);
			parseRuns = 0;
			parsedCharacters = 0;
			durations.length = 0;
			let text = initial;
			for (let i = 0; i < 40; i++) {
				text += name === "table" ? `| More ${i} | Streamed record | ${i} |\n` : `More content ${i}. `;
				render(text, true);
				await pause(50);
			}
			text += name === "code" ? "\n```\n\nBENCHMARK_DONE" : "\n\nBENCHMARK_DONE";
			render(text, false);
			const deadline = performance.now() + 5000;
			while (!host.textContent?.includes("BENCHMARK_DONE")) {
				if (performance.now() > deadline) throw new Error("Final source did not flush");
				await paint();
			}
			await pause(250);
			const sorted = [...durations].sort((a, b) => a - b);
			results.push({
				name, sourceCharacters: text.length, updates: 40, parseRuns, parsedCharacters,
				commits: durations.length,
				reactRenderMs: +durations.reduce((sum, value) => sum + value, 0).toFixed(1),
				p95CommitMs: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
			});
		} finally {
			root.unmount();
			host.remove();
		}
	}
	return results;
}
