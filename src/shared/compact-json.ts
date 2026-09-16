/**
 * Two-space indentation on a JSON tool response is pure transport cost, and
 * unlike the `tools/list` manifest — paid once per connect — it is paid on
 * EVERY call. `CLAUDE_MEM_COMPACT_JSON=true` (or `=1`) drops it.
 *
 * Whitespace only: no key dropped, no value truncated, no array capped. The
 * parsed payload is identical by construction, because the only thing that
 * changes is `JSON.stringify`'s spacer argument.
 *
 * Default OFF, and read live per call, so the flag is the only thing that can
 * change what this server emits — unset, output is byte-identical to before.
 *
 * This is the single place tool responses get serialised. A local
 * `JSON.stringify(payload, null, 2)` in a handler is the bug, not a shortcut:
 * it opts that one tool out of the flag with nothing to catch it.
 */
export function compactJsonEnabled(): boolean {
  const value = process.env.CLAUDE_MEM_COMPACT_JSON;
  return value === 'true' || value === '1';
}

export function jsonResponseText(payload: unknown): string {
  return JSON.stringify(payload, null, compactJsonEnabled() ? 0 : 2);
}
