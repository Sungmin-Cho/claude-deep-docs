import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  captureOpenedFileIdentity,
  revalidateOwnedFileIdentity,
  stateDependencies,
} from '../scripts/runtime/state.js';

test('owned file identity accepts Windows path-stat dev zero when inode and birthtime match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deep docs windows identity '));
  try {
    const canonicalRoot = await realpath(root);
    const target = join(canonicalRoot, 'owned.tmp');
    await writeFile(target, 'owned\n');
    const handle = await open(target, 'r');
    let expectedIdentity;
    try {
      expectedIdentity = await captureOpenedFileIdentity(handle);
    } finally {
      await handle.close();
    }
    assert.notEqual(expectedIdentity.dev, 0n);
    assert.equal(typeof expectedIdentity.birthtimeNs, 'bigint');

    const deps = stateDependencies({
      lstat: async (candidate, options) => {
        const metadata = await lstat(candidate, options);
        if (options?.bigint !== true) return metadata;
        return {
          dev: 0n,
          ino: expectedIdentity.ino,
          birthtimeNs: expectedIdentity.birthtimeNs,
          isFile: () => metadata.isFile(),
        };
      },
    });

    await revalidateOwnedFileIdentity(
      canonicalRoot,
      target,
      canonicalRoot,
      expectedIdentity,
      { deps },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('owned file identity rejects when device is not comparable and either birthtime is zero', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deep docs zero birthtime identity '));
  try {
    const canonicalRoot = await realpath(root);
    const target = join(canonicalRoot, 'owned.tmp');
    await writeFile(target, 'owned\n');
    const metadata = await lstat(target, { bigint: true });
    const expectedIdentity = {
      dev: 0n,
      ino: metadata.ino,
      birthtimeNs: metadata.birthtimeNs,
    };
    const deps = stateDependencies({
      lstat: async (candidate, options) => {
        const current = await lstat(candidate, options);
        if (options?.bigint !== true) return current;
        return {
          dev: 0n,
          ino: current.ino,
          birthtimeNs: 0n,
          isFile: () => current.isFile(),
        };
      },
    });

    await assert.rejects(
      revalidateOwnedFileIdentity(
        canonicalRoot,
        target,
        canonicalRoot,
        expectedIdentity,
        { deps },
      ),
      /opened file identity changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('owned file identity accepts a birthtime mismatch when device is comparable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deep docs comparable device birthtime '));
  try {
    const canonicalRoot = await realpath(root);
    const target = join(canonicalRoot, 'owned.tmp');
    await writeFile(target, 'owned\n');
    const handle = await open(target, 'r');
    let expectedIdentity;
    try {
      expectedIdentity = await captureOpenedFileIdentity(handle);
    } finally {
      await handle.close();
    }
    assert.notEqual(expectedIdentity.dev, 0n);
    assert.notEqual(expectedIdentity.birthtimeNs, 0n);

    const deps = stateDependencies({
      lstat: async (candidate, options) => {
        const current = await lstat(candidate, options);
        if (options?.bigint !== true) return current;
        return {
          dev: expectedIdentity.dev,
          ino: expectedIdentity.ino,
          birthtimeNs: expectedIdentity.birthtimeNs + 1n,
          isFile: () => current.isFile(),
        };
      },
    });

    await revalidateOwnedFileIdentity(
      canonicalRoot,
      target,
      canonicalRoot,
      expectedIdentity,
      { deps },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('owned file identity still rejects unequal nonzero devices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deep docs strict device identity '));
  try {
    const canonicalRoot = await realpath(root);
    const target = join(canonicalRoot, 'owned.tmp');
    await writeFile(target, 'owned\n');
    const metadata = await lstat(target, { bigint: true });
    const expectedIdentity = {
      dev: metadata.dev === 0n ? 1n : metadata.dev,
      ino: metadata.ino,
      birthtimeNs: metadata.birthtimeNs,
    };
    const deps = stateDependencies({
      lstat: async (candidate, options) => {
        const current = await lstat(candidate, options);
        if (options?.bigint !== true) return current;
        return {
          dev: expectedIdentity.dev + 1n,
          ino: current.ino,
          birthtimeNs: expectedIdentity.birthtimeNs,
          isFile: () => current.isFile(),
        };
      },
    });

    await assert.rejects(
      revalidateOwnedFileIdentity(
        canonicalRoot,
        target,
        canonicalRoot,
        expectedIdentity,
        { deps },
      ),
      /opened file identity changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('owned file identity rejects a birthtime mismatch when device is not comparable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deep docs birthtime identity '));
  try {
    const canonicalRoot = await realpath(root);
    const target = join(canonicalRoot, 'owned.tmp');
    await writeFile(target, 'owned\n');
    const metadata = await lstat(target, { bigint: true });
    const expectedIdentity = {
      dev: 0n,
      ino: metadata.ino,
      birthtimeNs: metadata.birthtimeNs,
    };
    const deps = stateDependencies({
      lstat: async (candidate, options) => {
        const current = await lstat(candidate, options);
        if (options?.bigint !== true) return current;
        return {
          dev: 0n,
          ino: current.ino,
          birthtimeNs: expectedIdentity.birthtimeNs + 1n,
          isFile: () => current.isFile(),
        };
      },
    });

    await assert.rejects(
      revalidateOwnedFileIdentity(
        canonicalRoot,
        target,
        canonicalRoot,
        expectedIdentity,
        { deps },
      ),
      /opened file identity changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
