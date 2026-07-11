import { spawnSync } from 'node:child_process';

export const SOURCE_PROJECTION_PATHS = Object.freeze([
  '.',
  ':(exclude).deep-docs',
  ':(exclude).deep-docs/**',
]);

export function runGit(
  root,
  args,
  { input, acceptedStatuses = [0], allowFailure = false } = {},
) {
  const result = spawnSync('git', args, {
    cwd: root,
    input,
    encoding: null,
    shell: false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  const missing = result.error?.code === 'ENOENT';
  const status = result.status ?? (missing ? 127 : 1);
  const value = {
    ok: !result.error && acceptedStatuses.includes(status),
    status,
    missing,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.error?.message ?? result.error ?? ''),
  };
  if (!value.ok && !allowFailure) {
    const detail = value.stderr.trim();
    throw new Error(`git ${args[0] ?? '<empty>'} failed${detail ? `: ${detail}` : ''}`);
  }
  return value;
}

export function isGitRepository(root) {
  const probe = runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  return probe.ok && probe.stdout.toString('utf8').trim() === 'true';
}

