#!/usr/bin/env node
'use strict';

const { existsSync, realpathSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { isSea } = require('node:sea');
const { pathToFileURL } = require('node:url');

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseEnvArray(name) {
  const raw = process.env[name];
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!isStringArray(parsed)) {
    throw new Error(`${name} must be a JSON string array.`);
  }
  return parsed;
}

function isSniptailRoot(dir) {
  return (
    existsSync(join(dir, 'packages', 'cli', 'dist', 'index.js')) &&
    existsSync(join(dir, 'scripts', 'register-loaders.mjs'))
  );
}

function resolveSniptailRoot() {
  const rootFromEnv = process.env.SNIPTAIL_ROOT?.trim();
  if (rootFromEnv) {
    return resolve(rootFromEnv);
  }

  const candidates = [];
  try {
    candidates.push(resolve(dirname(realpathSync(process.execPath)), '..'));
  } catch {
    // Ignore lookup failure and continue with fallback paths.
  }
  candidates.push(resolve(dirname(process.execPath), '..'));
  candidates.push(resolve(__dirname, '..'));

  const resolved = candidates.find((candidate) => isSniptailRoot(candidate));
  if (resolved) return resolved;
  return candidates[0];
}

function isDuplicateExecArg(value) {
  if (!value) return false;
  if (resolve(value) === resolve(process.execPath)) return true;
  try {
    return realpathSync(value) === realpathSync(process.execPath);
  } catch {
    return false;
  }
}

async function preloadImports(nodeArgs) {
  for (let i = 0; i < nodeArgs.length; i += 1) {
    const arg = nodeArgs[i];
    if (arg === '--import') {
      const importPath = nodeArgs[i + 1];
      if (!importPath) {
        throw new Error('Missing value for --import in SNIPTAIL_INTERNAL_NODE_ARGS.');
      }
      i += 1;
      await import(pathToFileURL(resolve(importPath)).href);
      continue;
    }

    if (arg.startsWith('--import=')) {
      const importPath = arg.slice('--import='.length).trim();
      if (!importPath) {
        throw new Error('Missing value for --import= in SNIPTAIL_INTERNAL_NODE_ARGS.');
      }
      await import(pathToFileURL(resolve(importPath)).href);
      continue;
    }

    throw new Error(`Unsupported Node arg in SEA internal mode: ${arg}`);
  }
}

async function run() {
  const root = resolveSniptailRoot();
  process.env.SNIPTAIL_ROOT = process.env.SNIPTAIL_ROOT?.trim() || root;
  process.env.NODE_ENV = process.env.NODE_ENV?.trim() || 'production';

  const internalEntry = process.env.SNIPTAIL_INTERNAL_ENTRY?.trim();
  if (internalEntry) {
    const nodeArgs = parseEnvArray('SNIPTAIL_INTERNAL_NODE_ARGS');
    const entryArgs = parseEnvArray('SNIPTAIL_INTERNAL_ARGS');
    const resolvedEntry = resolve(internalEntry);

    await preloadImports(nodeArgs);
    process.argv = [process.execPath, resolvedEntry, ...entryArgs];
    await import(pathToFileURL(resolvedEntry).href);
    return;
  }

  const cliEntry = join(root, 'packages', 'cli', 'dist', 'index.js');
  let forwardedArgs = isSea() ? process.argv.slice(1) : process.argv.slice(2);
  if (isSea() && forwardedArgs.length > 0 && isDuplicateExecArg(forwardedArgs[0])) {
    // Some SEA runtimes duplicate argv[0] into argv[1]. Drop it so CLI parsing matches normal Node.
    forwardedArgs = forwardedArgs.slice(1);
  }
  process.argv = [process.execPath, cliEntry, ...forwardedArgs];
  await import(pathToFileURL(cliEntry).href);
}

run().catch((err) => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
