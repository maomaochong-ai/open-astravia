// @vitest-environment jsdom
/**
 * 「通用设置 → 网络代理」的完整使用流程：开代理 → 填地址 → 按服务商排除。
 * 从连接层的 hook 进入，跑真实的 view，只把 `window.vetta` 这层真外部边界换掉。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { ProxySettingsSection } = await import("./ProxySettingsSection.js");
const { useProxySettingsModel } = await import("./useProxySettingsModel.js");

function Harness(): JSX.Element {
	return <ProxySettingsSection model={useProxySettingsModel()} />;
}

function switchByName(name: string): HTMLButtonElement {
	return screen.getByRole("switch", { name }) as HTMLButtonElement;
}

function isOn(element: HTMLElement): boolean {
	return element.getAttribute("aria-checked") === "true";
}

function installVetta(options: { proxyEnabled?: boolean } = {}): {
	configSet: ReturnType<typeof vi.fn>;
	modelsSet: ReturnType<typeof vi.fn>;
} {
	const configSet = vi.fn(async () => {});
	const modelsSet = vi.fn(async () => {});
	const modelsConfig = {
		providers: {
			anthropic: { displayName: "Anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
			deepseek: { displayName: "DeepSeek", api: "openai-completions", baseUrl: "https://api.deepseek.com" },
			// 厂商 SDK 自己发请求，注入的传输到不了它。
			google: {
				displayName: "Google",
				api: "google-generative-ai",
				baseUrl: "https://generativelanguage.googleapis.com",
			},
			// 本机桥接网关：这一跳根本没出网。
			"cli-proxy-api": {
				displayName: "CLIProxyAPI",
				api: "google-generative-ai",
				baseUrl: "http://127.0.0.1:49507/v1beta",
			},
		},
	};
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			config: {
				get: vi.fn(async () => ({
					proxy: {
						enabled: options.proxyEnabled ?? false,
						protocol: "http",
						host: "",
						port: 7890,
						username: "",
						passwordConfigured: false,
					},
				})),
				set: configSet,
			},
			models: { get: vi.fn(async () => structuredClone(modelsConfig)), set: modelsSet },
		},
	});
	return { configSet, modelsSet };
}

afterEach(() => {
	cleanup();
	Reflect.deleteProperty(window, "vetta");
});

describe("网络代理设置", () => {
	it("默认关闭，关闭时不展示地址与服务商开关", async () => {
		installVetta();

		render(<Harness />);

		await waitFor(() => expect(switchByName("proxy.enableTitle")).toBeTruthy());
		expect(isOn(switchByName("proxy.enableTitle"))).toBe(false);
		expect(screen.queryByRole("textbox", { name: "proxy.hostTitle" })).toBeNull();
		expect(screen.queryByRole("switch", { name: "Anthropic" })).toBeNull();
	});

	it("用户开启代理后立即保存，并展开地址与逐服务商开关", async () => {
		const { configSet } = installVetta();
		const user = userEvent.setup();
		render(<Harness />);
		await waitFor(() => expect(switchByName("proxy.enableTitle")).toBeTruthy());

		await user.click(switchByName("proxy.enableTitle"));

		expect(configSet).toHaveBeenCalledWith({ proxy: { enabled: true } });
		expect(screen.getByRole("textbox", { name: "proxy.hostTitle" })).toBeTruthy();
		// 缺省跟随全局：开了代理，服务商默认就在代理里。
		await waitFor(() => expect(isOn(switchByName("Anthropic"))).toBe(true));
	});

	it("输入代理地址时先跟手显示，停止输入后才落盘一次", async () => {
		const { configSet } = installVetta({ proxyEnabled: true });
		const user = userEvent.setup();
		render(<Harness />);
		const host = (await screen.findByRole("textbox", { name: "proxy.hostTitle" })) as HTMLInputElement;

		await user.type(host, "127.0.0.1");

		expect(host.value).toBe("127.0.0.1");
		expect(configSet).not.toHaveBeenCalled();
		await waitFor(() => expect(configSet).toHaveBeenCalledExactlyOnceWith({ proxy: { host: "127.0.0.1" } }));
	});

	it("用户可以把个别服务商排除出代理", async () => {
		const { modelsSet } = installVetta({ proxyEnabled: true });
		const user = userEvent.setup();
		render(<Harness />);
		await waitFor(() => expect(switchByName("DeepSeek")).toBeTruthy());

		await user.click(switchByName("DeepSeek"));

		expect(isOn(switchByName("DeepSeek"))).toBe(false);
		await waitFor(() => {
			expect(modelsSet).toHaveBeenCalledWith(
				expect.objectContaining({
					providers: expect.objectContaining({ deepseek: expect.objectContaining({ useProxy: false }) }),
				}),
			);
		});
		// 其他服务商不受影响。
		expect(isOn(switchByName("Anthropic"))).toBe(true);
	});

	it("厂商 SDK 自己发请求的服务商显示为跟随全局、开关只读，并说明原因", async () => {
		installVetta({ proxyEnabled: true });
		render(<Harness />);

		await waitFor(() => expect(switchByName("Google")).toBeTruthy());
		// 它确实走代理，只是拨不动——显示成关着会让人以为漏了它。
		expect(isOn(switchByName("Google"))).toBe(true);
		expect(switchByName("Google").disabled).toBe(true);
		expect(screen.getByText("proxy.providerFollowsGlobal")).toBeTruthy();
	});

	it("上游在本机的服务商显示为始终直连、开关只读，并说明原因", async () => {
		installVetta({ proxyEnabled: true });
		render(<Harness />);

		await waitFor(() => expect(switchByName("CLIProxyAPI")).toBeTruthy());
		// 它压根不出网，显示成「走代理」会让人以为开了代理就被接管了。
		expect(isOn(switchByName("CLIProxyAPI"))).toBe(false);
		expect(switchByName("CLIProxyAPI").disabled).toBe(true);
		expect(screen.getByText("proxy.providerLocal")).toBeTruthy();
	});

	it("地址填不全时提示请求会失败，而不是让用户以为改走了直连", async () => {
		installVetta({ proxyEnabled: true });
		render(<Harness />);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("proxy.invalidConfig");
	});
});
