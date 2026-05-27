#!/usr/bin/env node
// validate-envelope-emit.js — deep-docs M3 envelope contract self-test.
//
// Inline check (no suite dependency, no ajv). Verifies that a deep-docs
// last-scan emit conforms to the M3 envelope contract documented in
// claude-deep-suite/docs/envelope-migration.md §1 and the deep-docs/last-scan
// payload-registry seed.
//
// Usage:
//   node scripts/validate-envelope-emit.js [path/to/last-scan.json]
//
// Default path: tests/fixtures/sample-last-scan.json (positive fixture).
// Exit: 0 = pass, 1 = fail (errors printed to stderr, prefix "validate-envelope-emit:").

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/sample-last-scan.json');

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const GIT_HEAD_RE = /^[a-f0-9]{7,40}$/;
const SCHEMA_VERSION_RE = /^\d+\.\d+$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const WORKTREE_HASH_RE = /^([a-f0-9]{40}|no-git)$/;

// Suite envelope schema declares `additionalProperties: false` at root,
// `envelope`, `git`, `provenance`, and each `source_artifacts[]` item, with
// `^x-` patternProperties allowed for forward-compat at root + envelope.
// Mirroring those allow-lists here closes the contract gap that lets a stray
// legacy field (e.g., root-level `scanned_at`) silently pass the local self-test
// while failing the suite validator (round-2 adversarial finding).
const ALLOWED_ROOT_KEYS = new Set(['$schema', 'schema_version', 'envelope', 'payload']);
const ALLOWED_ENVELOPE_KEYS = new Set([
  'producer', 'producer_version', 'artifact_kind', 'run_id', 'session_id',
  'parent_run_id', 'generated_at', 'schema', 'git', 'provenance',
]);
const ALLOWED_GIT_KEYS = new Set(['head', 'branch', 'worktree', 'dirty']);
const ALLOWED_PROVENANCE_KEYS = new Set(['source_artifacts', 'tool_versions']);
const ALLOWED_SOURCE_ARTIFACT_KEYS = new Set(['path', 'run_id']);
const ALLOWED_SCHEMA_KEYS = new Set(['name', 'version']);
// payload.gaps[] (authoring) — write-path input, so its shape is locked too.
const ALLOWED_GAP_KEYS = new Set([
  'type', 'category', 'severity', 'target_path', 'exists', 'evidence', 'authoring_spec',
]);
const ALLOWED_AUTHORING_SPEC_KEYS = new Set(['doc_kind', 'mode', 'rationale']);
const GAP_TYPES = new Set(['missing-doc', 'thin-doc']);
const SUMMARY_COUNT_KEYS = ['total_issues', 'auto_fixable', 'authoring', 'audit_only'];

function isNonNegInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

const errors = [];
function fail(msg) { errors.push(msg); }

function reportUnknownKeys(obj, allowed, label, allowXExt) {
  if (!obj || typeof obj !== 'object') return;
  const extra = Object.keys(obj).filter((k) => !allowed.has(k) && !(allowXExt && k.startsWith('x-')));
  if (extra.length > 0) {
    fail(`${label}: unknown ${allowXExt ? 'non-x- ' : ''}keys [${extra.join(', ')}]`);
  }
}

function loadPlugin() {
  const raw = readFileSync(resolve(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf8');
  return JSON.parse(raw);
}

function check(target) {
  const path = resolve(target);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`);
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`invalid JSON in ${path}: ${e.message}`);
    return;
  }

  // 1. top-level envelope wrapper version (locked).
  if (data.schema_version !== '1.0') {
    fail(`schema_version must be "1.0" (got ${JSON.stringify(data.schema_version)})`);
  }
  if (typeof data.envelope !== 'object' || data.envelope === null) {
    fail('envelope block missing or not an object');
    return;
  }
  if (!('payload' in data)) fail('payload field missing');

  // additionalProperties: false enforcement (suite-spec mirror; allows ^x- at root + envelope).
  reportUnknownKeys(data, ALLOWED_ROOT_KEYS, 'root', true);
  reportUnknownKeys(data.envelope, ALLOWED_ENVELOPE_KEYS, 'envelope', true);

  const env = data.envelope;

  // 2. producer / artifact_kind / schema identity (Phase 1 round-4 lesson).
  if (env.producer !== 'deep-docs') {
    fail(`envelope.producer must be "deep-docs" (got ${JSON.stringify(env.producer)})`);
  }
  if (env.artifact_kind !== 'last-scan') {
    fail(`envelope.artifact_kind must be "last-scan" (got ${JSON.stringify(env.artifact_kind)})`);
  }
  if (!env.producer || !KEBAB_RE.test(env.producer)) {
    fail(`envelope.producer must be kebab-case (got ${JSON.stringify(env.producer)})`);
  }
  if (!env.artifact_kind || !KEBAB_RE.test(env.artifact_kind)) {
    fail(`envelope.artifact_kind must be kebab-case (got ${JSON.stringify(env.artifact_kind)})`);
  }
  if (!env.schema || env.schema.name !== env.artifact_kind) {
    fail(`envelope.schema.name (${JSON.stringify(env.schema?.name)}) must equal envelope.artifact_kind (${JSON.stringify(env.artifact_kind)})`);
  }
  if (!env.schema || !SCHEMA_VERSION_RE.test(env.schema.version || '')) {
    fail(`envelope.schema.version must match \\d+\\.\\d+ (got ${JSON.stringify(env.schema?.version)})`);
  }
  if (env.schema?.version !== '1.1') {
    fail(`envelope.schema.version must be "1.1" for this release (got ${JSON.stringify(env.schema?.version)})`);
  }

  // 3. producer_version === plugin.json.version (single source of truth).
  const plugin = loadPlugin();
  if (env.producer_version !== plugin.version) {
    fail(`envelope.producer_version (${JSON.stringify(env.producer_version)}) must match plugin.json.version (${JSON.stringify(plugin.version)})`);
  }
  if (!SEMVER_RE.test(env.producer_version || '')) {
    fail(`envelope.producer_version must be SemVer 2.0.0 strict (got ${JSON.stringify(env.producer_version)})`);
  }

  // 4. run_id ULID (Crockford Base32, 26 chars, MSB-first time).
  if (!ULID_RE.test(env.run_id || '')) {
    fail(`envelope.run_id must match ULID regex ^[0-9A-HJKMNP-TV-Z]{26}$ (got ${JSON.stringify(env.run_id)})`);
  }

  // 5. generated_at RFC 3339.
  if (!RFC3339_RE.test(env.generated_at || '')) {
    fail(`envelope.generated_at must be RFC 3339 (got ${JSON.stringify(env.generated_at)})`);
  }

  // 6. git block.
  if (!env.git || typeof env.git !== 'object') {
    fail('envelope.git missing');
  } else {
    reportUnknownKeys(env.git, ALLOWED_GIT_KEYS, 'envelope.git', false);
    if (!GIT_HEAD_RE.test(env.git.head || '')) {
      fail(`envelope.git.head must match ^[a-f0-9]{7,40}$ (got ${JSON.stringify(env.git.head)})`);
    }
    if (typeof env.git.branch !== 'string' || env.git.branch.length === 0) {
      fail(`envelope.git.branch must be non-empty string (got ${JSON.stringify(env.git.branch)})`);
    }
    if (env.git.dirty !== true && env.git.dirty !== false && env.git.dirty !== 'unknown') {
      fail(`envelope.git.dirty must be true|false|"unknown" (got ${JSON.stringify(env.git.dirty)})`);
    }
  }

  // 7. provenance block.
  if (!env.provenance || typeof env.provenance !== 'object') {
    fail('envelope.provenance missing');
  } else {
    reportUnknownKeys(env.provenance, ALLOWED_PROVENANCE_KEYS, 'envelope.provenance', false);
    if (!Array.isArray(env.provenance.source_artifacts)) {
      fail('envelope.provenance.source_artifacts must be an array');
    } else {
      env.provenance.source_artifacts.forEach((sa, idx) => {
        if (!sa || typeof sa.path !== 'string' || sa.path.length === 0) {
          fail(`envelope.provenance.source_artifacts[${idx}].path must be non-empty string`);
        } else {
          reportUnknownKeys(sa, ALLOWED_SOURCE_ARTIFACT_KEYS, `envelope.provenance.source_artifacts[${idx}]`, false);
        }
      });
    }
    // tool_versions: must be a non-array object whose values are string|object (suite schema mirror).
    // typeof [] === 'object' in JS, so Array.isArray() guard is required.
    const tv = env.provenance.tool_versions;
    if (!tv || typeof tv !== 'object' || Array.isArray(tv)) {
      fail(`envelope.provenance.tool_versions must be a non-array object (got ${Array.isArray(tv) ? 'array' : typeof tv})`);
    } else {
      for (const [k, v] of Object.entries(tv)) {
        if (typeof v === 'string') continue;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) continue;
        fail(`envelope.provenance.tool_versions.${k} must be string or non-array object (got ${Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v)})`);
      }
    }
  }

  // schema block additionalProperties (already verified .name/.version present).
  if (env.schema && typeof env.schema === 'object') {
    reportUnknownKeys(env.schema, ALLOWED_SCHEMA_KEYS, 'envelope.schema', false);
  }

  // 8. payload structure (deep-docs/last-scan v1.0 shape).
  const pl = data.payload;
  if (!pl || typeof pl !== 'object') {
    fail('payload must be an object');
    return;
  }
  if (!Array.isArray(pl.documents)) {
    fail('payload.documents must be an array');
  } else {
    // Minimal per-entry shape check (full schema deferred to suite-side
    // payload-registry per handoff §3.4). Each document must be a non-null,
    // non-array object with `path` (non-empty string), `issues` (array),
    // and `metrics` (object). Per-issue/metric/summary shape is the suite
    // schema's job; this just blocks the obvious null/empty cases.
    pl.documents.forEach((doc, idx) => {
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        fail(`payload.documents[${idx}] must be a non-null, non-array object`);
        return;
      }
      if (typeof doc.path !== 'string' || doc.path.length === 0) {
        fail(`payload.documents[${idx}].path must be non-empty string`);
      }
      if (!Array.isArray(doc.issues)) {
        fail(`payload.documents[${idx}].issues must be an array`);
      }
      if (!doc.metrics || typeof doc.metrics !== 'object' || Array.isArray(doc.metrics)) {
        fail(`payload.documents[${idx}].metrics must be a non-null, non-array object`);
      }
    });
  }
  // payload.gaps[] (authoring; optional). [R3-plan:medium] write 경로 입력 — enum/매핑/traversal 강제.
  const DOC_KIND_TO_PATH = { 'claude-md': 'CLAUDE.md', 'agents-md': 'AGENTS.md', 'architecture-md': 'ARCHITECTURE.md' };
  if ('gaps' in pl) {
    if (!Array.isArray(pl.gaps)) {
      fail('payload.gaps must be an array when present');
    } else {
      pl.gaps.forEach((g, idx) => {
        if (!g || typeof g !== 'object' || Array.isArray(g)) {
          fail(`payload.gaps[${idx}] must be a non-null, non-array object`); return;
        }
        reportUnknownKeys(g, ALLOWED_GAP_KEYS, `payload.gaps[${idx}]`, false);
        if (g.category !== 'authoring') fail(`payload.gaps[${idx}].category must be "authoring"`);
        // type enum + exists boolean (write-path input — block malformed scanner output).
        if (!GAP_TYPES.has(g.type)) {
          fail(`payload.gaps[${idx}].type must be one of ${[...GAP_TYPES].join('|')} (got ${JSON.stringify(g.type)})`);
        }
        if (typeof g.exists !== 'boolean') {
          fail(`payload.gaps[${idx}].exists must be boolean (got ${JSON.stringify(g.exists)})`);
        }
        const sp = g.authoring_spec;
        if (!sp || typeof sp !== 'object' || Array.isArray(sp)) {
          fail(`payload.gaps[${idx}].authoring_spec must be a non-null object`); return;
        }
        reportUnknownKeys(sp, ALLOWED_AUTHORING_SPEC_KEYS, `payload.gaps[${idx}].authoring_spec`, false);
        if (!(sp.doc_kind in DOC_KIND_TO_PATH)) {
          fail(`payload.gaps[${idx}].authoring_spec.doc_kind must be one of ${Object.keys(DOC_KIND_TO_PATH).join('|')}`);
        }
        if (sp.mode !== 'create' && sp.mode !== 'restructure') {
          fail(`payload.gaps[${idx}].authoring_spec.mode must be "create" or "restructure"`);
        }
        // type ⇔ exists ⇔ mode mapping (spec §4.5): missing-doc ⇔ exists:false ⇔ create;
        // thin-doc ⇔ exists:true ⇔ restructure. The thin-doc⇔restructure hard-mapping
        // matches scanner (doc-scanner.md:189) + garden create-branch dispatch (SKILL.md ①/⑥):
        // a thin-doc with mode:create would route to the create branch's lstat() existence
        // check and fail-closed (the doc already exists) — a dead path. Enforcing the
        // mapping here closes the asymmetry (missing-doc already pins mode:create).
        if (g.type === 'missing-doc') {
          if (g.exists !== false) {
            fail(`payload.gaps[${idx}]: missing-doc must have exists:false (got ${JSON.stringify(g.exists)})`);
          }
          if (sp.mode !== 'create') {
            fail(`payload.gaps[${idx}]: missing-doc must have authoring_spec.mode "create" (got ${JSON.stringify(sp.mode)})`);
          }
        } else if (g.type === 'thin-doc') {
          if (g.exists !== true) {
            fail(`payload.gaps[${idx}]: thin-doc must have exists:true (got ${JSON.stringify(g.exists)})`);
          }
          if (sp.mode !== 'restructure') {
            fail(`payload.gaps[${idx}]: thin-doc must use authoring_spec.mode "restructure" (got ${JSON.stringify(sp.mode)})`);
          }
        }
        const tp = g.target_path;
        const expected = DOC_KIND_TO_PATH[sp.doc_kind];
        if (typeof tp !== 'string' || !tp) {
          fail(`payload.gaps[${idx}].target_path must be non-empty string`);
        } else if (tp.startsWith('/') || tp.includes('\\') || /^[A-Za-z]:/.test(tp) || tp.split('/').includes('..')) {
          // [R3-plan-R4] absolute / drive-root(C:) / backslash / ".." traversal 거부
          fail(`payload.gaps[${idx}].target_path must be root-local POSIX path (no absolute / drive-root / backslash / ".." traversal)`);
        } else if (expected && tp !== expected) {
          // [R4] root-only exact match (spec §4.2: 모노레포 하위 패키지는 v2). endsWith 는 nested(src/x/CLAUDE.md)
          // 를 통과시키므로 금지 — exact 비교만으로 nested/접두(fooCLAUDE.md)/모든 우회를 차단.
          fail(`payload.gaps[${idx}].target_path must be exactly "${expected}" (root-only; monorepo subpaths deferred to v2)`);
        }
      });
    }
  }
  if (!pl.summary || typeof pl.summary !== 'object' || Array.isArray(pl.summary)) {
    fail('payload.summary must be a non-null, non-array object');
  } else {
    // All four count fields are REQUIRED (omitting one previously slipped past the
    // key-existence guard) and must each be a non-negative integer (no sentinels /
    // floats / negatives). [codex review P2 + adversarial medium]
    for (const k of SUMMARY_COUNT_KEYS) {
      if (!(k in pl.summary)) {
        fail(`payload.summary.${k} is required (must be present)`);
      } else if (!isNonNegInt(pl.summary[k])) {
        fail(`payload.summary.${k} must be a non-negative integer (got ${JSON.stringify(pl.summary[k])})`);
      }
    }
    // Recompute the issue-category tallies from documents[].issues[] and enforce
    // equality (the summary was previously never cross-checked against the actual
    // issues). gaps[] are NOT issues (D12: authoring counts gaps[], not issues[]).
    const docs = Array.isArray(pl.documents) ? pl.documents : [];
    let recomputedAutoFix = 0;
    let recomputedAuditOnly = 0;
    let recomputedTotal = 0;
    for (const doc of docs) {
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.issues)) continue;
      for (const iss of doc.issues) {
        if (!iss || typeof iss !== 'object') continue;
        recomputedTotal += 1;
        if (iss.category === 'auto-fix') recomputedAutoFix += 1;
        else if (iss.category === 'audit-only') recomputedAuditOnly += 1;
      }
    }
    const gapCount = Array.isArray(pl.gaps) ? pl.gaps.length : 0;
    // auto_fixable === Σ(issues where category==='auto-fix')
    if ('auto_fixable' in pl.summary && pl.summary.auto_fixable !== recomputedAutoFix) {
      fail(`payload.summary.auto_fixable (${JSON.stringify(pl.summary.auto_fixable)}) must equal documents[].issues[] auto-fix count (${recomputedAutoFix})`);
    }
    // audit_only === Σ(issues where category==='audit-only')
    if ('audit_only' in pl.summary && pl.summary.audit_only !== recomputedAuditOnly) {
      fail(`payload.summary.audit_only (${JSON.stringify(pl.summary.audit_only)}) must equal documents[].issues[] audit-only count (${recomputedAuditOnly})`);
    }
    // total_issues === total documents[].issues[] (= auto_fixable + audit_only; gaps excluded — D12)
    if ('total_issues' in pl.summary && pl.summary.total_issues !== recomputedTotal) {
      fail(`payload.summary.total_issues (${JSON.stringify(pl.summary.total_issues)}) must equal total documents[].issues[] count (${recomputedTotal})`);
    }
    // authoring === gaps[] length (always compared — omission already failed above).
    if ('authoring' in pl.summary && pl.summary.authoring !== gapCount) {
      fail(`payload.summary.authoring (${JSON.stringify(pl.summary.authoring)}) must equal gaps[] length (${gapCount})`);
    }
  }
  if (!pl.provenance || typeof pl.provenance !== 'object') {
    fail('payload.provenance must be an object');
  } else {
    if (typeof pl.provenance.is_git !== 'boolean') {
      fail(`payload.provenance.is_git must be boolean (got ${JSON.stringify(pl.provenance.is_git)})`);
    }
    if (!WORKTREE_HASH_RE.test(pl.provenance.worktree_hash || '')) {
      fail(`payload.provenance.worktree_hash must match ^[a-f0-9]{40}$ or "no-git" (got ${JSON.stringify(pl.provenance.worktree_hash)})`);
    }
  }
}

const target = process.argv[2] || DEFAULT_FIXTURE;
check(target);

if (errors.length > 0) {
  for (const e of errors) {
    process.stderr.write(`validate-envelope-emit: ${e}\n`);
  }
  process.exit(1);
}

process.stdout.write(`✓ ${target} matches deep-docs M3 envelope contract\n`);
