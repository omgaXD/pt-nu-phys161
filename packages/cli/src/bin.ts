#!/usr/bin/env node
import { main } from './program.js';

// Output piped into `head` and the like: stop quietly when the reader goes away.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw e;
  });
}

process.exitCode = await main(process.argv.slice(2));
