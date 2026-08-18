/**
 * 重新生成随包内置的 models.dev 目录快照。
 *
 * 快照是网络不可达且无本地缓存时的兜底(国内网络下 models.dev 常在 TLS 阶段被阻断),
 * 运行时永远优先线上数据,拉到就覆盖它。所以它可以旧,但不能没有。
 *
 * 用法:
 *   bun run scripts/update-models-dev-snapshot.ts              # 联网从 models.dev 拉
 *   bun run scripts/update-models-dev-snapshot.ts --from x.json # 从本地文件生成
 *
 * --from 接受两种文件:models.dev 原始 api.json,或本地缓存
 * ~/.vetta/agent/models-dev-cache.json(已裁剪过的目录)。网络拉不通时用后者。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, isCatalogUsable, type ModelsDevCatalog } from "../src/main/models/presets/models-dev.js";

const OUTPUT = join(
	dirname(fileURLToPath(import.meta.url)),
	"../src/main/models/presets/models-dev-snapshot.generated.ts",
);

function parseArgs(): { from?: string } {
	const index = process.argv.indexOf("--from");
	return index === -1 ? {} : { from: process.argv[index + 1] };
}

async function loadCatalog(from: string | undefined): Promise<ModelsDevCatalog> {
	const now = Date.now();
	if (!from) {
		const response = await fetch("https://models.dev/api.json", { headers: { Accept: "application/json" } });
		if (!response.ok) throw new Error(`models.dev 返回 ${response.status} ${response.statusText}`);
		return buildCatalog(await response.json(), now);
	}
	const parsed = JSON.parse(readFileSync(from, "utf8"));
	// 已经是本地缓存(裁剪过的目录)就原样用,否则按原始 api.json 折算。
	if (isCatalogUsable(parsed)) return parsed as ModelsDevCatalog;
	return buildCatalog(parsed, now);
}

const { from } = parseArgs();
const catalog = await loadCatalog(from);
const counts = Object.entries(catalog.providers)
	.map(([id, models]) => `${id}=${Object.keys(models).length}`)
	.join(" ");

writeFileSync(
	OUTPUT,
	`// AUTO-GENERATED models.dev 目录快照。不要手改——跑 \`bun run snapshot:models-dev\` 重新生成。
// 网络不可达且无本地缓存时的兜底(见 ADR-0050);运行时拉到线上数据就覆盖它。
import type { ModelsDevCatalog } from "./models-dev.js";

export const MODELS_DEV_SNAPSHOT: ModelsDevCatalog = ${JSON.stringify(catalog, null, "\t")};
`,
);

console.log(`快照已更新：${OUTPUT}`);
console.log(`  来源：${from ?? "https://models.dev/api.json"}`);
console.log(`  时间：${catalog.fetchedAt}`);
console.log(`  模型：${counts}`);
