import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");

// Files copied verbatim. The logo files are listed by name on purpose: the build fails if any is missing.
export const ASSETS = [
  "logo-mark-160.png",
  "logo-mark-512.png",
  "brand-512.png",
  "apple-touch-icon.png",
  "favicon.svg",
];
export const COPY_DIRS = ["css", "js"];

// Dates live in register.json as data only; anything rendered gets them stripped.
export function publicRegister(reg) {
  const copy = JSON.parse(JSON.stringify(reg));
  delete copy.note;
  for (const r of Object.values(copy.records)) delete r.recordedOn;
  return copy;
}

export function themeColor() {
  const css = fs.readFileSync(path.join(SRC, "css", "tokens.css"), "utf8");
  const m = css.match(/--c-bg:\s*(#[0-9a-fA-F]{6})/);
  if (!m) throw new Error("tokens.css: --c-bg not found");
  return m[1];
}

export function loadRegister() {
  return JSON.parse(fs.readFileSync(path.join(SRC, "data", "register.json"), "utf8"));
}

export async function build({ outDir = path.join(ROOT, "dist"), register = loadRegister() } = {}) {
  const render = await import(pathToFileURL(path.join(SRC, "js", "render.js")).href + "?t=" + Date.now() + Math.random());
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const pub = publicRegister(register);
  const R = pub.records;
  const ca = render.recordByKind(R, "address")[0];
  const stated = ca && render.isStated(ca) && render.ADDRESS_RE.test(ca.value || "");

  let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
  const slot = (name, s) => (html = html.replace(`<!--@${name}-->`, () => s));
  slot("social", render.renderSocial(R));
  slot("social2", render.renderSocial(R));
  slot("social3", render.renderSocial(R));
  slot("ca", ca ? render.renderCa(ca) : "");
  slot("infra", render.renderInfra(R));
  // Row #1 is a placeholder in the static output; the browser swaps in live data when the address is stated.
  slot("own", render.renderOwnPlaceholder());
  html = html.replace("@@THEME@@", themeColor());
  html = html.replace("@@REGISTER@@", () => JSON.stringify(pub).replace(/</g, "\\u003c"));
  if (html.includes("@@") || /<!--@/.test(html)) throw new Error("unreplaced template marker");
  fs.writeFileSync(path.join(outDir, "index.html"), html);

  for (const d of COPY_DIRS) fs.cpSync(path.join(SRC, d), path.join(outDir, d), { recursive: true });
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
  for (const f of ASSETS) {
    const from = path.join(SRC, "assets", f);
    if (!fs.existsSync(from)) throw new Error("missing asset: " + f);
    fs.copyFileSync(from, path.join(outDir, "assets", f));
  }
  // Post-build proof that the logo is present and referenced.
  const logo = path.join(outDir, "assets", "logo-mark-160.png");
  if (!fs.existsSync(logo) || fs.statSync(logo).size < 1000) throw new Error("logo missing from output");
  if (!html.includes('src="assets/logo-mark-160.png"')) throw new Error("index.html does not reference the logo");
  return { outDir, stated, html };
}
