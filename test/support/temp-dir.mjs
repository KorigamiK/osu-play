import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

export function withTempDir(prefix, callback) {
  const tempDir = mkdtempSync(path.join(process.cwd(), `.tmp-${prefix}-`));

  try {
    return callback(tempDir);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}
