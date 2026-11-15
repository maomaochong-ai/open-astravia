// The engine template ships inside the plugin bundle as raw text and is
// materialized to ~/.astravia/design-engine/<version>/ at runtime (plugin fs.write
// is project-scoped, so materialization goes through a `node -e` bootstrap).
import engineIndexHtml from "../../engine/index.html?raw";
import enginePackageJson from "../../engine/package.json?raw";
import enginePackageLockJson from "../../engine/package-lock.json?raw";
import engineBridge from "../../engine/src/bridge.ts?raw";
import engineBridgeProtocol from "../../engine/src/bridge-protocol.ts?raw";
import engineMain from "../../engine/src/main.tsx?raw";
import engineRoutes from "../../engine/src/routes.ts?raw";
import engineStorageSync from "../../engine/src/storage-sync.ts?raw";
import engineStyles from "../../engine/src/styles.css?raw";
import engineViteConfig from "../../engine/vite.config.mjs?raw";

/**
 * relPath (inside the engine root) → file content.
 *
 * 这张表就是引擎的完整形态：materialize 只写这里列出的文件，`engineReady` 也只看
 * 内容 hash。加一个引擎源码文件却忘了列进来，物化出来的引擎会缺那个模块——
 * `src/bridge.ts` import 不到 `./bridge-protocol` 时整帧编译失败，画布上每一帧都
 * 白等满 8 秒截图超时。`test/engine-files.test.ts` 遍历 engine/src 拦住这种漏项。
 */
export const ENGINE_FILES: Record<string, string> = {
	"package.json": enginePackageJson,
	// 与 package.json 一起 materialize，安装才能走 `npm ci`（见 engine-manager
	// 的 installDependencies）：省掉 ~190 个包的范围解析往返。lock 里的 resolved
	// 主机不会架空镜像——npm 按当前 registry 配置改写下载主机。
	"package-lock.json": enginePackageLockJson,
	"vite.config.mjs": engineViteConfig,
	"index.html": engineIndexHtml,
	"src/main.tsx": engineMain,
	"src/bridge.ts": engineBridge,
	"src/bridge-protocol.ts": engineBridgeProtocol,
	"src/routes.ts": engineRoutes,
	"src/storage-sync.ts": engineStorageSync,
	"src/styles.css": engineStyles,
};

/**
 * 引擎自带、设计源码可以直接 import 的包。
 *
 * 这是 vite.config.mjs 里那组 alias 的另一半事实：这些包装在**引擎**的
 * node_modules 里，设计源码走 node 解析够不到，靠 alias 钉过去。设计自己装的包
 * 不在这张表里——那些在 `x.astravia-design/node_modules/`，天然就能解析。
 */
export const ENGINE_PROVIDED_PACKAGES = ["react", "react-dom", "react-router", "lucide-react"] as const;

/**
 * 新建设计时写进 `x.astravia-design/package.json` 的运行时依赖版本。
 *
 * 从引擎 package.json 现取而不是再抄一份：两处各写一份，引擎升级 react 的那天
 * 就会对不上，而症状是第三方库的 peer 校验开始报警告，很难联想到这里。
 */
export function engineRuntimeDependencies(): Record<string, string> {
	const parsed = JSON.parse(enginePackageJson) as { dependencies?: Record<string, string> };
	const declared = parsed.dependencies ?? {};
	const runtime: Record<string, string> = {};
	// lucide-react 不进去：它是图标的兜底路径（见 vite.config.mjs 的 alias 注释），
	// 由引擎 alias 接住，不该出现在用户设计的依赖清单里。
	for (const name of ["react", "react-dom", "react-router"]) {
		const version = declared[name];
		if (version) runtime[name] = version;
	}
	return runtime;
}

/** Stable content hash so a plugin update re-materializes changed templates. */
export function engineFilesHash(): string {
	let hash = 5381;
	for (const key of Object.keys(ENGINE_FILES).sort()) {
		// `\u0000` 分隔键与内容，避免相邻条目的拼接产生歧义。
		const text = `${key}\u0000${ENGINE_FILES[key]}`;
		for (let i = 0; i < text.length; i++) {
			hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
		}
	}
	return (hash >>> 0).toString(36);
}
