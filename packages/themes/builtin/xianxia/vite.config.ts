import { federation } from "@module-federation/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [
		tailwindcss(),
		federation({
			name: "theme_xianxia",
			filename: "remoteEntry.js",
			exposes: {
				"./theme": "./src/index.ts",
			},
			manifest: {
				fileName: "mf-manifest.json",
			},
			publicPath: "auto",
			dts: false,
			shared: {
				"@vetta/desktop-theme-ui/app-shell": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta/desktop-theme-ui/sidebar": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-sdk": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-sdk/pages": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-sdk/routing": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-sdk/storage": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-sdk/usage": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-ui": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-ui/app-shell": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/theme-ui/sidebar": { singleton: true, import: false, requiredVersion: "*" },
				"@vetta-org/ui": { singleton: true, import: false, requiredVersion: "*" },
				"motion/react": { singleton: true, import: false, requiredVersion: "*" },
				react: { singleton: true, import: false, requiredVersion: "*" },
				"react-dom": { singleton: true, import: false, requiredVersion: "*" },
			},
		}),
	],
	server: {
		host: "127.0.0.1",
		origin: "http://127.0.0.1:3010",
		port: 3010,
		strictPort: true,
	},
	build: {
		assetsDir: "assets",
		rollupOptions: {
			input: "./src/index.ts",
			output: {
				// Module Federation 的共享包虚拟 chunk 名会拼进完整包名，可达 140+ 字符；
				// Windows 安装目录下整条路径会超过 MAX_PATH，导致 MSI 打包失败。
				chunkFileNames(chunkInfo) {
					return chunkInfo.name.startsWith("_virtual_mf") ? "assets/mf-[hash].js" : "assets/[name]-[hash].js";
				},
				assetFileNames(assetInfo) {
					return assetInfo.names.some((name) => name.endsWith(".css"))
						? "style.css"
						: "assets/[name]-[hash][extname]";
				},
			},
		},
	},
});
