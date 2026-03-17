#!/usr/bin/env bun

import { $ } from "bun";
import { chmodSync, copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");

function copyTypeFile(fileName) {
  const sourcePath = path.join(distDir, `${fileName}.d.ts`);
  const cjsTypePath = path.join(distDir, `${fileName}.d.cts`);

  if (!existsSync(sourcePath)) {
    throw new Error(`Expected declaration file at ${sourcePath}`);
  }

  copyFileSync(sourcePath, cjsTypePath);
}

rmSync(distDir, { force: true, recursive: true });

await $`bun build --outdir=dist --root=src --entry-naming=[name].js --target=node --packages=external --sourcemap=external --format=esm ./src/index.ts ./src/cli.ts`.cwd(
  rootDir,
);

await $`bun build --outdir=dist --root=src --entry-naming=[name].cjs --target=node --packages=external --sourcemap=external --format=cjs ./src/index.ts ./src/cli.ts`.cwd(
  rootDir,
);

await $`bun x tsc --project tsconfig.build.json --emitDeclarationOnly --declaration --declarationMap false --outDir dist`.cwd(
  rootDir,
);

copyTypeFile("index");
copyTypeFile("cli");

chmodSync(path.join(distDir, "cli.js"), 0o755);
chmodSync(path.join(distDir, "cli.cjs"), 0o755);
