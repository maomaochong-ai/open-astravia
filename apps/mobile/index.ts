// Must stay the first import: @noble/* reads globalThis.crypto at module load.
import "./src/remote/platform/install-crypto-polyfill";
import "expo-router/entry";
