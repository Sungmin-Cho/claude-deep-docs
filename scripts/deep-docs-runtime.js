#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildScanContext } from './runtime/scan.js';
import {
  ensureRealStateDirectory,
  resolveAndValidateRealTargetRoot,
  RuntimeError,
} from './runtime/state.js';

const modulePath = fileURLToPath(import.meta.url);
export const PLUGIN_ROOT = resolve(dirname(modulePath), '..');

function argvError(message) {
  return new RuntimeError('argv', message);
}

function parseScanContext(args) {
  let root;
  let pathCheckEnabled = false;
  let sawPathCheck = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--root') {
      if (root !== undefined) throw argvError('repeated --root');
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw argvError('missing --root value');
      }
      root = value;
      index += 1;
    } else if (token === '--path-check-enabled') {
      if (sawPathCheck) throw argvError('repeated --path-check-enabled');
      sawPathCheck = true;
      pathCheckEnabled = true;
    } else if (token.startsWith('--')) {
      throw argvError(`unknown option: ${token}`);
    } else {
      throw argvError(`unexpected positional: ${token}`);
    }
  }
  if (root === undefined) throw argvError('missing --root');
  return { root, pathCheckEnabled };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command !== 'scan-context') {
    throw argvError(`unknown command: ${command ?? '<empty>'}`);
  }
  const parsed = parseScanContext(args);
  const root = await resolveAndValidateRealTargetRoot(parsed.root);
  await ensureRealStateDirectory(root);
  const value = await buildScanContext(root, {
    pathCheckEnabled: parsed.pathCheckEnabled,
  });
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  main().catch((error) => {
    const code = typeof error?.code === 'string' ? error.code : 'operation';
    const message = String(error?.message ?? error).replace(/[\r\n]+/g, ' ').trim();
    process.stderr.write(`deep-docs-runtime: ${code}: ${message || 'operation failed'}\n`);
    process.exitCode = 1;
  });
}
