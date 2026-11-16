// BREAKWATER — program/v1 harness entry for the make.fun threejs-fps-01
// bounty. The game itself is the static site under game/ (open game/index.html
// in a browser, or `node serve.ts`); this entry's only job is to publish that
// site plus the screenshots into the output directory and emit the dossier
// the judges read, using the kit's vendored library, unchanged.
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDossier } from "./vendor/makefun-threejs.ts";

const root = import.meta.dirname;
const out = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
cpSync(join(root, "game"), join(out, "game"), { recursive: true });
cpSync(join(root, "screenshots"), join(out, "screenshots"), { recursive: true });
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, "dossier.json"), dossier);
