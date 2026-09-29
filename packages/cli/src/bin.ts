#!/usr/bin/env node
import { main } from './program.js';

process.exitCode = await main(process.argv.slice(2));
