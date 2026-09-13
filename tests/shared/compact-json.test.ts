import { describe, it, expect, afterEach } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compactJsonEnabled, jsonResponseText } from '../../src/shared/compact-json.js';

const ON = (v = 'true') => { process.env.CLAUDE_MEM_COMPACT_JSON = v; };
const OFF = () => { delete process.env.CLAUDE_MEM_COMPACT_JSON; };
afterEach(OFF);

// Shaped like serializeObservation() output: uuids, epochs, a metadata object,
// and a long prose `content` string. The prose matters — it dilutes the
// indentation share, so a fixture of short fields alone would overstate the win.
function observations(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `01998b3e-0000-7000-8000-00000000000${i % 10}`,
    projectId: 'claude-mem',
    teamId: '01998b3e-1111-7000-8000-111111111111',
    serverSessionId: i % 3 === 0 ? null : `01998b3e-2222-7000-8000-22222222222${i % 10}`,
    kind: 'decision',
    content: `Routed every MCP JSON response through one serializer so the compact flag cannot be opted out of per tool. Observation ${i}.`,
    metadata: { files: ['src/shared/compact-json.ts'], tags: ['mcp', 'tokens'], confidence: 0.82 },
    createdAtEpoch: 1_757_000_000 + i,
    updatedAtEpoch: 1_757_000_100 + i,
  }));
}

describe('compact-json — default OFF, byte-identical', () => {
  it('emits exactly what JSON.stringify(payload, null, 2) emitted before', () => {
    OFF();
    const payload = { observations: observations(5) };
    expect(jsonResponseText(payload)).toBe(JSON.stringify(payload, null, 2));
  });

  it('only "true" or "1" enables it', () => {
    OFF();
    expect(compactJsonEnabled()).toBe(false);
    for (const v of ['false', 'TRUE', 'True', 'yes', '0', '']) {
      ON(v);
      expect(compactJsonEnabled()).toBe(false);
    }
    for (const v of ['true', '1']) {
      ON(v);
      expect(compactJsonEnabled()).toBe(true);
    }
  });
});

describe('compact-json — enabled: whitespace only', () => {
  it('parses to identical data and carries no newlines', () => {
    ON();
    const payload = { observations: observations(25) };
    const after = jsonResponseText(payload);
    expect(JSON.parse(after)).toEqual(payload);
    expect(after).not.toContain('\n');
  });

  it('saves a material fraction on an observation list, and reports it', () => {
    const payload = { observations: observations(25) };
    OFF();
    const before = jsonResponseText(payload);
    ON();
    const after = jsonResponseText(payload);
    const pct = (1 - after.length / before.length) * 100;
    console.log(`compact-json: ${before.length} -> ${after.length} chars (-${pct.toFixed(1)}%)`);
    // A floor, not a pin — the exact figure moves with the payload shape.
    expect(pct).toBeGreaterThan(8);
  });

  it('handles scalars, null and empty collections without damage', () => {
    ON();
    for (const p of ['a string', 42, true, null, [], {}]) {
      expect(JSON.parse(jsonResponseText(p))).toEqual(p as never);
    }
  });
});

// The mechanical class: an MCP text response built with an inline indented
// JSON.stringify opts that one tool out of the flag, silently. Nothing in the
// type system stops a fifth site, so this scans for the shape.
describe('compact-json — no MCP response bypasses the serializer', () => {
  function tsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) tsFiles(full, out);
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
    }
    return out;
  }

  const files = tsFiles('src');

  it('found the call sites it is meant to be guarding', () => {
    const routed = files.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/jsonResponseText\(/g)?.length ?? 0),
      0,
    );
    // Guard the guard: a scanner that matches nothing reports success forever.
    expect(files.length).toBeGreaterThan(100);
    expect(routed).toBeGreaterThanOrEqual(5); // 4 call sites + the definition
  });

  it('finds no inline indented JSON.stringify inside an MCP text response', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/JSON\.stringify\([^;\n]*?,\s*null,\s*2\s*\)/g)) {
        const window = source.slice(Math.max(0, match.index - 200), match.index + 200);
        if (/content:\s*\[/.test(window) && /type:\s*'text'/.test(window)) {
          violations.push(`${file}: ${match[0].slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
