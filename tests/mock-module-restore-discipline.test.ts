import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * bun's `mock.module` is PROCESS-GLOBAL and `mock.restore()` does not undo it.
 * A test file that mocks a module and never re-registers the real one poisons
 * every file that runs after it in the same `bun test` process — and because
 * file discovery order is filesystem order, which file gets poisoned changes
 * when anyone adds a test file. That is how this landed: adding one unrelated
 * test file moved the order enough that an unrestored
 * `@modelcontextprotocol/sdk/client/index.js` mock reached the recall-server
 * suite, and 12 tests went red on CI while passing locally.
 *
 * The convention (already documented in the chroma manager suites) is to
 * snapshot the real namespace at import time and re-register it in afterAll.
 * This test is the thing that makes the convention hold: a specifier passed to
 * `mock.module` must appear at least twice in the file — once to mock, once to
 * restore.
 */
describe('mock.module discipline — every process-global mock is restored', () => {
  function testFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) testFiles(full, out);
      else if (entry.endsWith('.test.ts')) out.push(full);
    }
    return out;
  }

  // This file is excluded: its own regexes and prose contain the very string
  // it scans for, so it would always flag itself.
  const SELF = 'mock-module-restore-discipline.test.ts';
  const files = testFiles('tests').filter(f => !f.endsWith(SELF));
  const mocking = files
    .map(file => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => source.includes('mock.module('));

  it('found the files it is meant to be guarding', () => {
    // Guard the guard: a scanner that matches nothing reports success forever.
    expect(files.length).toBeGreaterThan(100);
    expect(mocking.length).toBeGreaterThan(10);
  });

  it('leaves no mocked module unrestored', () => {
    const leaks: string[] = [];
    for (const { file, source } of mocking) {
      const specifiers = new Set(
        [...source.matchAll(/mock\.module\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]),
      );
      for (const specifier of specifiers) {
        const uses = source.split(`mock.module('${specifier}'`).length - 1
          + source.split(`mock.module("${specifier}"`).length - 1;
        // One occurrence = mocked and never re-registered.
        if (uses < 2) leaks.push(`${file} -> ${specifier}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
