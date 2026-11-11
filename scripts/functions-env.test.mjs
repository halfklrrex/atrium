// Guard for the committed Functions config `functions/.env.atrium-board`. CI deploys from a fresh
// checkout, so the file must be committed (not gitignored) and, being public, must hold no secrets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoRoot } from './env.mjs';

const ENV_FILE = 'functions/.env.atrium-board';
// Add a key here only if it is non-secret: this file is committed to a public repository.
const ALLOWED_KEYS = ['ACCOUNT_APPROVAL_REQUIRED', 'MCP_CONNECTOR_ENABLED'];

const entries = readFileSync(join(repoRoot, ENV_FILE), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const eq = line.indexOf('=');
    return eq < 0 ? [line, ''] : [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
  });

test('only allow-listed, non-secret keys are committed', () => {
  for (const [key] of entries) {
    assert.ok(
      ALLOWED_KEYS.includes(key),
      `${ENV_FILE} has the key "${key}", which is not in the allow-list. This file is public: add a key to ALLOWED_KEYS in scripts/functions-env.test.mjs only if it is non-secret. Secrets belong in Secret Manager.`,
    );
  }
});

test('ACCOUNT_APPROVAL_REQUIRED is true or false', () => {
  const value = entries.find(([key]) => key === 'ACCOUNT_APPROVAL_REQUIRED')?.[1];
  assert.ok(
    value === 'true' || value === 'false',
    `ACCOUNT_APPROVAL_REQUIRED must be "true" or "false", got "${value}"`,
  );
});

test('MCP_CONNECTOR_ENABLED is true or false', () => {
  const value = entries.find(([key]) => key === 'MCP_CONNECTOR_ENABLED')?.[1];
  assert.ok(
    value === 'true' || value === 'false',
    `MCP_CONNECTOR_ENABLED must be "true" or "false", got "${value}"`,
  );
});

test('the file is not gitignored, so CI deploys carry it', () => {
  let ignored = true;
  try {
    execFileSync('git', ['check-ignore', '-q', ENV_FILE], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    ignored = false; // exit code 1 means "not ignored"
  }
  assert.equal(
    ignored,
    false,
    `${ENV_FILE} is gitignored; keep the "!${ENV_FILE}" rule in .gitignore`,
  );
});
