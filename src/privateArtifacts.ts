import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Some filesystems ignore chmod; POSIX tests cover supported platforms.
  }
}

export function writePrivateFileAtomic(path: string, content: string): void {
  ensurePrivateDir(dirname(path));
  const tmpPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmpPath, content, { mode: 0o600 });
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // Best effort on platforms without POSIX chmod support.
  }
  renameSync(tmpPath, path);
}
