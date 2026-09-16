// =============================================================================
//  scripts/_loadEnvLocal.ts
//  Side-effect module: load .env.local into process.env. Import this FIRST in a
//  script (before any @/lib import), because ES modules evaluate their imports
//  in order — and libs like lib/db capture env at module-load time, so the values
//  must be present before those modules evaluate. Best-effort; existing env wins.
// =============================================================================

import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — rely on the exported environment */
}
