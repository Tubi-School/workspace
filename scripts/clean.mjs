#!/usr/bin/env node
/**
 * Removes every build artifact and installed dependency in the workspace.
 *
 * Turborepo caches aggressively and pnpm uses symlinked `node_modules`; when a
 * tree gets into a bad state the fastest recovery is a full reset. Pass
 * `--keep-deps` to drop only build output.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const keepDeps = process.argv.includes('--keep-deps');

const artifacts = ['dist', '.next', '.turbo', 'out', 'coverage', 'tsconfig.tsbuildinfo'];
const generated = [join('apps', 'api', 'src', 'generated')];

/** Every directory that can hold artifacts: the root plus each workspace. */
function workspaceDirs() {
  const dirs = [repoRoot];

  for (const group of ['apps', 'packages']) {
    const groupPath = join(repoRoot, group);
    let entries;
    try {
      entries = readdirSync(groupPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = join(groupPath, entry);
      if (statSync(candidate).isDirectory()) dirs.push(candidate);
    }
  }

  return dirs;
}

/** @param {string} target */
function remove(target) {
  rmSync(target, { recursive: true, force: true });
}

for (const dir of workspaceDirs()) {
  for (const artifact of artifacts) remove(join(dir, artifact));
  if (!keepDeps) remove(join(dir, 'node_modules'));
}

for (const target of generated) remove(join(repoRoot, target));

console.log(
  keepDeps
    ? '[tubi] Build artifacts removed. Dependencies left in place.'
    : '[tubi] Build artifacts and node_modules removed. Run "pnpm install" to continue.',
);
