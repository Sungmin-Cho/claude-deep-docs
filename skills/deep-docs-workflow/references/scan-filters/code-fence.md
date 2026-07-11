# Filter: code-fence

## Purpose and executable source

`splitNonFencedSegments(text)` in `scripts/runtime/scan.js` is the exported executable contract. `extractReferences(text)` consumes its output. Fenced content is excluded from reference extraction and each returned prose line retains its original one-based line number.

This prevents examples inside fenced blocks from becoming dead references and prevents prose on opposite sides of a fence from being concatenated into a false duplicate window.

## Opener contract

For each line, Node matches four facts:

- `indent`: exactly 0–3 literal spaces;
- `marker`: a run of at least three identical backticks or tildes;
- `char`: the marker's first character;
- `count`: marker length;
- `info`: the remaining suffix, retained as trimmed documentary info.

An opener is valid when no fence is active and:

1. marker count is at least three;
2. indent is at most three spaces;
3. for a backtick opener, the untrimmed info suffix contains no backtick;
4. a tilde opener may contain backticks in its info.

The opener line is not returned as prose.

## Closer contract

While a fence is active, a line closes it only when all conditions hold:

1. the same marker character is used;
2. marker count is greater than or equal to the opener count;
3. indentation is 0–3 spaces;
4. the suffix after the marker is whitespace only.

A shorter marker, other character, four-space-indented marker, or closer with info remains fenced content. A valid closer is not returned as prose. An unclosed fence at EOF is conservative: all remaining lines stay excluded.

## Result shape

The function returns one entry per non-fenced source line:

```json
[
  { "text": "See `src/api.ts`.", "line": 12 }
]
```

It does not join lines. Consumers that compute exact 3-line duplicates build windows only from returned lines whose original line numbers are consecutive within the same prose segment; a line-number gap left by a removed fence is a hard window boundary.

## Complete edge matrix

| Input fact | Result |
|---|---|
| three backticks, no indent | opener |
| four or more backticks | opener whose `count` is the full run |
| three tildes | opener |
| 1–3 leading spaces before marker | opener/closer recognized |
| 4 leading spaces before marker | not a fence marker; later indented-code exclusion still applies |
| backtick opener with ordinary language info | opener |
| backtick opener whose info contains a backtick | not an opener |
| tilde opener whose info contains a backtick | opener |
| same char closer with equal count | closes |
| same char closer with longer count | closes |
| four-marker opener followed by three-marker line | does not close |
| backtick opener followed by tilde marker | does not close |
| closer followed only by spaces/tabs | closes |
| closer followed by non-whitespace info | does not close |
| valid opener with no closer before EOF | remaining content excluded |
| CRLF input | split identically; returned text excludes the carriage return |
| fence at first/last line | handled without an artificial prose line |

## Safety and failure behavior

- The function is pure and does no filesystem or command execution.
- It tracks only one active CommonMark fence because nested markers inside an active fence are content unless they satisfy the stricter closer.
- It deliberately does not weaken the closer to “same character only”; count and whitespace-only suffix are mandatory.
- Reference extraction additionally excludes indented code lines even when a four-space marker was not treated as a fence.

## Integration

- `extractReferences()` uses these lines and preserves their original line numbers.
- Duplicate classification uses segment-local windows and the `translationGroup()` result.
- Schema versions and scan categories are unaffected by this text contract.
