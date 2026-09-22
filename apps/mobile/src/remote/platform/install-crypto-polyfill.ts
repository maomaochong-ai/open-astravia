import { installCryptoPolyfill } from "./crypto-polyfill";

/**
 * Side-effect module: `@noble/hashes` captures `globalThis.crypto` once, while
 * it is being evaluated. The polyfill therefore has to run before anything
 * pulls in `@vetta/remote-control`, which is why the app entry imports this
 * module ahead of `expo-router/entry`.
 */
installCryptoPolyfill();
