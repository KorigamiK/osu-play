#!/usr/bin/env node
import { main } from "./core/cli/main.js";

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("Error:", error);
    process.exit(1);
  });
