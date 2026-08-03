#!/usr/bin/env node
/**
 * Guards the toolchain before dependencies are installed.
 *
 * Runs from the root `preinstall` hook. A mismatched Node or pnpm version is
 * the single most common cause of "works on my machine" monorepo breakage, so
 * we fail loudly and early rather than halfway through a build.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} range @param {string} actual */
function satisfiesMinimum(range, actual) {
  const minimum = range.replace(/^[>=^~\s]+/, '');
  const toParts = (/** @type {string} */ value) =>
    value
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
      .slice(0, 3);

  const [wantMajor = 0, wantMinor = 0, wantPatch = 0] = toParts(minimum);
  const [haveMajor = 0, haveMinor = 0, havePatch = 0] = toParts(actual);

  if (haveMajor !== wantMajor) return haveMajor > wantMajor;
  if (haveMinor !== wantMinor) return haveMinor > wantMinor;
  return havePatch >= wantPatch;
}

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const requiredNode = pkg.engines.node;
const actualNode = process.versions.node;

if (!satisfiesMinimum(requiredNode, actualNode)) {
  console.error(
    `\n[tubi] Node ${requiredNode} is required, but this shell is running ${actualNode}.\n` +
      `       Run "nvm use" (see .nvmrc) and try again.\n`,
  );
  process.exit(1);
}

// `npm_config_user_agent` looks like: "pnpm/10.33.0 npm/? node/v24.14.1 ..."
const userAgent = process.env.npm_config_user_agent ?? '';
const pnpmVersion = /pnpm\/(\d+\.\d+\.\d+)/.exec(userAgent)?.[1];

if (!pnpmVersion) {
  console.error(
    `\n[tubi] This repository is a pnpm workspace and cannot be installed with npm or yarn.\n` +
      `       Enable Corepack ("corepack enable") and run "pnpm install".\n`,
  );
  process.exit(1);
}

if (!satisfiesMinimum(pkg.engines.pnpm, pnpmVersion)) {
  console.error(
    `\n[tubi] pnpm ${pkg.engines.pnpm} is required, but found ${pnpmVersion}.\n` +
      `       Run "corepack use pnpm@latest" and try again.\n`,
  );
  process.exit(1);
}
