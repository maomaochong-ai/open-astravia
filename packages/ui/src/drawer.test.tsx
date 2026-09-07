// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "./drawer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

describe("DrawerContent", () => {
  test("mounts the portal in the caller-provided style boundary", async () => {
    const app = document.createElement("div");
    const pluginRoot = document.createElement("section");
    pluginRoot.dataset.vettaPluginRoot = "demo";
    document.body.append(app, pluginRoot);
    const root = createRoot(app);

    await act(async () => {
      root.render(
        <Drawer open direction="right">
          <DrawerContent portalContainer={pluginRoot}>
            <DrawerTitle>Records</DrawerTitle>
            <DrawerDescription>Saved records</DrawerDescription>
          </DrawerContent>
        </Drawer>,
      );
    });

    expect(pluginRoot.querySelector('[data-slot="drawer-content"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[data-slot="drawer-content"]')).toHaveLength(1);

    await act(async () => root.unmount());
  });
});
