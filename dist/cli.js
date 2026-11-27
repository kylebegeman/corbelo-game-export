#!/usr/bin/env node
import { runCommand } from "./node.js";
process.exitCode = await runCommand(process.argv.slice(2));
