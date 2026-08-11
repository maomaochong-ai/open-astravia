#!/usr/bin/env node
import { runPluginCli } from "./command.js";

process.exitCode = await runPluginCli(process.argv.slice(2));
