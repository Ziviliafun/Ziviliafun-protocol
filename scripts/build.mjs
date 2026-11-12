import { build } from "./lib/build-core.mjs";
import fs from "node:fs";
import path from "node:path";

const { outDir } = await build();
const list = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    f.isDirectory() ? walk(p) : list.push(path.relative(outDir, p).replace(/\\/g, "/") + " (" + fs.statSync(p).size + " bytes)");
  }
})(outDir);
console.log("built dist/\n  " + list.join("\n  "));
