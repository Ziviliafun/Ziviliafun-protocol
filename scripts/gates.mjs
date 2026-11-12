// Gates. Builds dist/ and a set of mutated variants, then checks every standing rule.
// Exit code 0 only if every gate passes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { build, ROOT, loadRegister, publicRegister, themeColor } from "./lib/build-core.mjs";

const TMP = path.join(ROOT, ".gate-tmp");
const DIST = path.join(ROOT, "dist");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));
const TEST_ADDR = "0x" + "ab12cd34ef56".repeat(4).slice(0, 40);
const ADDR_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (["node_modules", ".git", ".gate-tmp"].includes(e.name)) continue;
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const textFiles = (dir, exts) => walk(dir).filter((f) => exts.includes(path.extname(f)));

// Mutation anchor: find the record by kind at runtime, never by its current state.
function mutate(reg, kind, fn) {
  const copy = JSON.parse(JSON.stringify(reg));
  const key = Object.keys(copy.records).find((k) => copy.records[k].kind === kind);
  if (!key) throw new Error("no record of kind " + kind);
  const rec = copy.records[key];
  fn(rec, key);
  return copy;
}
const makeStated = (rec, fields) => { rec.state = "stated"; Object.assign(rec, fields); };
const makeInert = (rec, state = "absent") => { rec.state = state; for (const k of ["value", "url"]) delete rec[k]; };

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/g, " ");
}
function slice(html, a, b) { const i = html.indexOf(a); const j = html.indexOf(b, i + a.length); return i < 0 || j < 0 ? "" : html.slice(i, j); }

const gates = [];
const gate = (name, fn) => gates.push({ name, fn });

const baseReg = loadRegister();
const V = {}; // built variants
async function variants() {
  fs.rmSync(TMP, { recursive: true, force: true });
  V.absent = await build({ outDir: path.join(TMP, "absent"), register: mutate(baseReg, "address", (r) => makeInert(r, "absent")) });
  V.unconfirmed = await build({ outDir: path.join(TMP, "unconfirmed"), register: mutate(baseReg, "address", (r) => makeInert(r, "unconfirmed")) });
  V.stated = await build({ outDir: path.join(TMP, "stated"), register: mutate(baseReg, "address", (r) => makeStated(r, { value: TEST_ADDR })) });
  const regGh = JSON.parse(JSON.stringify(baseReg)); regGh.records.github = { kind: "link", state: "stated", label: "GitHub", url: "https://github.com/zivilia" };
  V.ghStated = await build({ outDir: path.join(TMP, "ghstated"), register: regGh });
  const regX = JSON.parse(JSON.stringify(baseReg)); delete regX.records.x.url; regX.records.x.state = "absent";
  V.xAbsent = await build({ outDir: path.join(TMP, "xabsent"), register: regX });
  V.main = await build({ outDir: DIST, register: baseReg });
}

/* ---- build and files ---- */
gate("dist/index.html exists and was produced by the build", () => { if (!exists("dist", "index.html")) throw new Error("missing"); });
gate("logo files copied into dist/assets and are real PNGs (RGBA mark)", () => {
  for (const f of ["logo-mark-160.png", "logo-mark-512.png"]) {
    const b = fs.readFileSync(path.join(DIST, "assets", f));
    if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(f + " not png");
    if (b[25] !== 6) throw new Error(f + " colour type " + b[25]);
    if (b.length < 2000) throw new Error(f + " too small");
  }
});
gate("index.html references the logo with a relative path that resolves inside dist/", () => {
  const html = read("dist", "index.html");
  const refs = [...html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((m) => m[1]);
  if (!refs.includes("assets/logo-mark-160.png")) throw new Error("logo not referenced");
  for (const r of refs) if (!exists("dist", r)) throw new Error("dangling reference " + r);
  if (/(?:src|href)="\//.test(html)) throw new Error("absolute path in reference");
});
gate("favicon: 32x32 SVG, no comments, no double hyphen, colours come from tokens", () => {
  const svg = read("dist", "assets", "favicon.svg");
  if (!/viewBox="0 0 32 32"/.test(svg)) throw new Error("viewBox");
  if (svg.includes("--") || svg.includes("<!--")) throw new Error("double hyphen or comment");
  const tokens = read("src", "css", "tokens.css").toLowerCase();
  for (const h of svg.match(HEX_RE) || []) if (!tokens.includes(h.toLowerCase())) throw new Error("hex not in tokens " + h);
});
gate("dist is self-contained: no README, LICENSE, docs, register.json, python or scripts", () => {
  const files = walk(DIST).map(rel);
  const bad = files.filter((f) => /readme|license|docs\/|register\.json|\.py$|scripts\//i.test(f));
  if (bad.length) throw new Error(bad.join(", "));
});

/* ---- palette ---- */
gate("palette: colour literals exist only in tokens.css (src and dist)", () => {
  const bad = [];
  for (const f of [...textFiles(path.join(ROOT, "src"), [".css", ".js", ".html"]), ...textFiles(DIST, [".css", ".js", ".html"])]) {
    if (f.endsWith("tokens.css")) continue;
    let t = fs.readFileSync(f, "utf8");
    t = t.replace(/<meta name="theme-color" content="#[0-9a-fA-F]{6}">/, ""); // derived from tokens by the build
    const m = t.match(HEX_RE);
    if (m) bad.push(rel(f) + ": " + m.join(","));
    if (/\b(rgb|hsl)a?\(/i.test(t)) bad.push(rel(f) + ": rgb/hsl literal");
  }
  if (bad.length) throw new Error(bad.join(" | "));
});
gate("palette: every token literal is sampled from an asset (palette.json provenance)", () => {
  const pal = JSON.parse(read("src", "assets", "palette.json"));
  const ok = new Set([...pal.logoOpaque.colours, ...pal.banner.colours, pal.banner.green].map((c) => c.hex.toLowerCase()));
  const lits = (read("src", "css", "tokens.css").match(HEX_RE) || []).map((h) => h.toLowerCase());
  const bad = lits.filter((h) => !ok.has(h));
  if (bad.length) throw new Error("not sampled: " + bad.join(","));
  if (themeColor().toLowerCase() !== pal.logoOpaque.colours[0].hex) throw new Error("theme colour is not the dominant logo pixel");
});

/* ---- register / link rule ---- */
gate("register: states valid; records that are not stated carry no value and no url", () => {
  const bad = [];
  for (const [k, r] of Object.entries(baseReg.records)) {
    if (!["stated", "absent", "unconfirmed"].includes(r.state)) bad.push(k + ": state");
    if (r.state !== "stated") for (const f of ["value", "url", "rpc", "chainId", "handle"]) if (f in r) bad.push(k + ": inert record carries " + f);
    if (r.state === "stated" && r.kind === "link" && !r.url) bad.push(k + ": stated link without url");
  }
  if (bad.length) throw new Error(bad.join("; "));
});
gate("register: chain record matches the client statement", () => {
  const c = baseReg.records.chain;
  if (c.state !== "stated" || c.chainId !== "0x1237" || c.rpc !== "https://rpc.mainnet.chain.robinhood.com") throw new Error(JSON.stringify(c));
});
gate("link rule: X anchor href equals the stored url; handle derived, never stored", () => {
  const html = V.main.html;
  const m = html.match(/<a class="icon-btn" data-social="x" href="([^"]+)"[^>]*aria-label="([^"]+)"/);
  if (!m || m[1] !== baseReg.records.x.url) throw new Error("x href");
  if (m[2] !== "X @zivilia") throw new Error("derived handle label: " + m[2]);
  if (JSON.stringify(baseReg).includes("@zivilia")) throw new Error("handle stored in register");
});
gate("link rule: GitHub inert in both branches (no href) and live when stated; X inert when absent", () => {
  const inert = (html, key) => {
    const m = html.match(new RegExp(`<span class="icon-btn is-inert" data-social="${key}"[^>]*>`));
    return !!m && !/href/.test(m[0]) && /aria-disabled="true"/.test(m[0]);
  };
  if (!inert(V.main.html, "github")) throw new Error("github not inert on main");
  if (!/<a class="icon-btn" data-social="github" href="https:\/\/github\.com\/zivilia"/.test(V.ghStated.html)) throw new Error("stated github not live");
  if (!inert(V.xAbsent.html, "x")) throw new Error("absent x not inert");
  if (/href="https:\/\/x\.com/.test(V.xAbsent.html)) throw new Error("x href leaked while absent");
  if (/github\.com/.test(V.main.html)) throw new Error("github url present while absent");
});
gate("social: icon-only, both present in header, never hidden by any breakpoint", () => {
  const head = slice(V.main.html, '<div class="social"', "</header>");
  if (!/data-social="x"/.test(head) || !/data-social="github"/.test(head)) throw new Error("icons missing from header");
  for (const m of V.main.html.matchAll(/<(?:a|span) class="icon-btn[^>]*>([\s\S]*?)<\/(?:a|span)>/g)) {
    if (visibleText(m[0]).trim()) throw new Error("text inside icon button: " + visibleText(m[0]).trim());
  }
  const css = read("src", "css", "main.css");
  if (/\.(social|icon-btn)[^{]*\{[^}]*display:\s*none/.test(css)) throw new Error("social hidden in css");
  const x = V.main.html.match(/data-social="x"[\s\S]*?<path fill="currentColor" d="([^"]+)"/)[1];
  if (!x.startsWith("M18.244 2.25h3.308")) throw new Error("not the X mark");
  const g = V.main.html.match(/data-social="github"[\s\S]*?<path fill="currentColor" d="([^"]+)"/)[1];
  if (!g.startsWith("M8 0c4.42 0 8 3.58 8 8a8.013")) throw new Error("not the Octicon mark-github");
});

/* ---- contract address, both branches ---- */
const caSlot = (html) => slice(html, 'data-slot="ca"', "</header>");
gate("CA absent/unconfirmed: slot inert, shows pending, no copy hook, no address-shaped string anywhere in dist", () => {
  for (const k of ["absent", "unconfirmed"]) {
    const s = caSlot(V[k].html);
    if (!/ca__btn is-inert/.test(s) || !/pending/.test(s)) throw new Error(k + ": not inert");
    if (/data-copy|<button/.test(s)) throw new Error(k + ": copy hook present");
    const all = textFiles(V[k].outDir, [".html", ".js", ".css", ".json", ".svg"]).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    if ((all.match(ADDR_RE) || []).length) throw new Error(k + ": address-shaped string present");
  }
});
gate("CA stated: full address in slot, click-to-copy wired, address mirrored only from the record", () => {
  const s = caSlot(V.stated.html);
  if (!s.includes(`data-copy="${TEST_ADDR}"`)) throw new Error("data-copy");
  if (!s.includes(`<code class="ca__addr">${TEST_ADDR}</code>`)) throw new Error("full address not rendered");
  if (!/data-copy-hint/.test(s)) throw new Error("feedback hook");
  const main = read("src", "js", "main.js");
  if (!/navigator\.clipboard\.writeText/.test(main) || !/Copied/.test(main)) throw new Error("copy feedback missing");
  const css = read("src", "css", "main.css");
  if (!/\.ca__addr\{[^}]*font-size:clamp\(14px,3\.9vw,26px\)/.test(css)) throw new Error("large CA type");
});
gate("address scanner: matches address-shaped strings against the stated registry, never blanket-rejects 0x", () => {
  const stated = new Set([TEST_ADDR.toLowerCase()]);
  const scan = (t) => (t.match(ADDR_RE) || []).filter((a) => !stated.has(a.toLowerCase()));
  if (scan("chain id 0x1237 and " + TEST_ADDR).length) throw new Error("false positive");
  if (!scan("0x" + "9".repeat(40)).length) throw new Error("scanner missed a foreign address");
  for (const k of ["absent", "stated"]) {
    const reg = k === "stated" ? new Set([TEST_ADDR.toLowerCase()]) : new Set();
    const all = textFiles(V[k].outDir, [".html", ".js", ".css", ".svg"]).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const foreign = (all.match(ADDR_RE) || []).filter((a) => !reg.has(a.toLowerCase()));
    if (foreign.length) throw new Error(k + ": foreign address " + foreign[0]);
  }
  if (!V.main.html.includes("0x1237")) throw new Error("chain id should still render");
});

/* ---- market ---- */
let M;
gate("market: parser maps tokens via base_token id, top-ten by volume, null/missing logo -> null, dedupes", async () => {
  M = await import(pathToFileURL(path.join(ROOT, "src", "js", "market.js")).href);
  const pool = (id, vol, chg, name, bp) => ({ attributes: { name, base_token_price_usd: bp, price_change_percentage: { h24: chg }, volume_usd: { h24: vol }, reserve_in_usd: "500" }, relationships: { base_token: { data: { id, type: "token" } } } });
  const tok = (id, sym, img, p) => ({ id, type: "token", attributes: { address: id.split("_")[1], symbol: sym, name: sym + " name", image_url: img, price_usd: p } });
  const data = [pool("rh_0xa", "100", "5.5", "AAA / WETH", "1"), pool("rh_0xb", "900", "-3", "BBB / WETH", "2"), pool("rh_0xb", "50", "0", "BBB / USDC", "2"), pool("rh_0xc", "400", null, "CCC / WETH", "3")];
  const included = [tok("rh_0xa", "AAA", "https://img/a.png", "1.1"), tok("rh_0xb", "BBB", null, null), tok("rh_0xc", "CCC", "missing.png", "3"), { id: "rh_0xw", type: "token", attributes: { symbol: "WETH" } }, { id: "p", type: "dex", attributes: {} }];
  const rows = M.parseTrending({ data, included });
  if (rows.length !== 3) throw new Error("dedupe: " + rows.length);
  const top = M.topByVolume(rows, 10);
  if (top.map((r) => r.symbol).join() !== "BBB,CCC,AAA") throw new Error("order " + top.map((r) => r.symbol));
  const a = top[2], b = top[0], c = top[1];
  if (a.price !== 1.1 || a.change !== 5.5 || a.volume !== 100 || a.logo !== "https://img/a.png") throw new Error("fields");
  if (b.logo !== null || b.price !== 2 || b.volume !== 900) throw new Error("fallback price/logo");
  if (c.logo !== null || c.change !== null) throw new Error("missing.png / null change");
});
gate("own token: dexscreener pair chosen by volume.h24 desc; dedup removes own from trending 2-10; row #1 pinned", () => {
  const dex = { pairs: [{ volume: { h24: 5 }, priceUsd: "1", priceChange: { h24: 1 }, liquidity: { usd: 10 }, baseToken: { symbol: "Z", name: "Z" } }, { volume: { h24: 50 }, priceUsd: "2", priceChange: { h24: -2 }, liquidity: { usd: 20 }, baseToken: { symbol: "Z", name: "Z" } }] };
  const own = M.parseDex(dex, TEST_ADDR);
  if (own.price !== 2 || own.volume !== 50 || own.change !== -2 || own.liquidity !== 20 || own.logo !== null) throw new Error("pair selection " + JSON.stringify(own));
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: "t" + i, address: i === 3 ? TEST_ADDR.toLowerCase() : "0x" + i, symbol: "S" + i }));
  const board = M.composeBoard(own, rows);
  if (board.rows.some((r) => r.address === TEST_ADDR.toLowerCase())) throw new Error("own not removed");
  if (board.rows.length !== 9) throw new Error("rows 2-10 should be 9, got " + board.rows.length);
  if (M.parseDex({ pairs: null }, TEST_ADDR) !== null) throw new Error("null pairs");
});
gate("own row, absent branch: brand logo tile (not letter), dotted data, not clickable, pulse intact", () => {
  for (const k of ["absent", "unconfirmed", "stated"]) {
    const row = slice(V[k].html, '<li class="row row--own"', "</li>");
    if (!row.includes('class="tile tile--brand"') || !row.includes('src="assets/logo-mark-160.png"')) throw new Error(k + ": no brand logo");
    if (/data-letter/.test(row) || /<a |<button|href|data-copy/.test(row)) throw new Error(k + ": interactive or letter tile");
    if ((row.match(/· · · · ·/g) || []).length < 4) throw new Error(k + ": dotted data");
  }
  const css = read("src", "css", "main.css").replace(/\s+/g, " ");
  if (!/\.row--own\{border-left:2px solid var\(--color-accent\)/.test(css)) throw new Error("border-left");
  if (!/\.row--own\{[^}]*animation:ownPulse/.test(css)) throw new Error("ownPulse");
});
gate("own row, stated branch: pair lookup url comes from the pairSource record, CA only appended; runs only when stated", () => {
  const main = read("src", "js", "main.js");
  if (!/isStated\(caRec\) && ADDRESS_RE\.test\(caRec\.value/.test(main)) throw new Error("stated guard");
  if (!/pairRec\.url \+ encodeURIComponent\(caRec\.value\)/.test(main)) throw new Error("url build");
  if (!/logo: null, \/\/ own logo always comes from brand assets/.test(read("src", "js", "market.js"))) throw new Error("own logo");
});
gate("market independence: market source block never reads the CA record; board/ticker/stats markup identical in every CA state", () => {
  const main = read("src", "js", "main.js");
  const block = slice(main, "const mrec = R.marketSource;", "/* ---------- own token");
  if (!block || /caRec|address|ADDRESS|recordByKind/.test(block)) throw new Error("market block touches CA");
  if (/marketSource|caRec|recordByKind|register/.test(read("src", "js", "market.js"))) throw new Error("market.js must not read any register record");
  const strip = (h) => slice(h, '<section class="container stats-band"', '<section class="section" id="studio">') + slice(h, 'data-ticker>', "<!--") + slice(h, 'class="market-status"', "</ul>");
  const norm = (h) => strip(h).replace(/\s+/g, " ");
  const a = norm(V.absent.html);
  if (!a.length) throw new Error("empty slice");
  for (const k of ["unconfirmed", "stated"]) if (norm(V[k].html) !== a) throw new Error(k + " differs from absent in market markup");
});
gate("market feed: register url, 60s poll, hidden-tab pause, immediate fetch on visible, exponential backoff, last good data kept", async () => {
  const mk = read("src", "js", "market.js"), main = read("src", "js", "main.js");
  if (!/every: 60000/.test(main)) throw new Error("60s");
  if (!/visibilitychange/.test(mk) || !/document\.hidden/.test(mk)) throw new Error("visibility");
  if (!/backoffDelay/.test(mk) || !/2 \*\* /.test(mk)) throw new Error("backoff");
  const rnd = Math.random; Math.random = () => 0.5;
  const d = [1, 2, 3, 4, 5, 6].map((n) => M.backoffDelay(n)); Math.random = rnd;
  if (!(d[1] > d[0] && d[2] > d[1] && d[3] > d[2] && d[5] <= 60000)) throw new Error("not exponential/capped: " + d);
  if (!/state\.trending = top/.test(main) || /state\.trending = \[\]/.test(main)) throw new Error("last good data must be kept");
  if (!/row--err/.test(main) || !/Source unreachable/.test(main)) throw new Error("dash + error state");
  if (!/m=\?|market-source|marketSource/.test(main)) throw new Error("source record");
  const u = baseReg.records.marketSource.url;
  if (!u.startsWith("https://api.geckoterminal.com/api/v2/networks/") || !u.endsWith("/trending_pools?include=base_token,quote_token&page=1")) throw new Error("url shape " + u);
});
gate("market ui: skeletons, letter-tile fallback, per-symbol copy, ticker, count-up with flash", () => {
  const main = read("src", "js", "main.js"), html = V.main.html;
  if (!/row--skel/.test(html) || !/skeletonPulse/.test(read("src", "css", "main.css"))) throw new Error("skeleton");
  if (!/letterTile/.test(main) || !/addEventListener\("error"/.test(main)) throw new Error("fallback");
  if (!/Copy symbol/.test(main)) throw new Error("per-symbol copy");
  if (!/data-ticker/.test(html) || !/function tween/.test(main) || !/cell-flash-up/.test(main)) throw new Error("ticker/count-up/flash");
});

/* ---- content rules ---- */
const DATE_RES = [
  [/\b20[2-3]\d\b/, "year"], [/\b\d{4}-\d{2}-\d{2}\b/, "iso date"], [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, "month day"],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/, "clock"], [/\b(utc|gmt)\b/i, "tz"], [/\bas of\b/i, "as of"], [/\bchecked\b/i, "checked"], [/\bupdated\b/i, "updated"], [/\btimestamp\b/i, "timestamp"], [/recordedOn/, "register date field"],
];
gate("no dates: nothing in dist (html, attributes, js, css, svg) reads as a date, time, 'as of' or 'checked'", () => {
  const bad = [];
  for (const f of textFiles(DIST, [".html", ".js", ".css", ".svg", ".json"])) {
    const t = fs.readFileSync(f, "utf8").replace(/cubic-bezier\([^)]*\)/g, "");
    for (const [re, label] of DATE_RES) { const m = t.match(re); if (m) bad.push(`${rel(f)}: ${label} "${m[0]}"`); }
  }
  if (bad.length) throw new Error(bad.join(" | "));
});
gate("reduced motion: media query zeroes every animation, own-row pulse, reveals; JS honours matchMedia", () => {
  const css = read("src", "css", "main.css").replace(/\s+/g, " ");
  const i = css.indexOf("@media (prefers-reduced-motion:reduce)");
  if (i < 0) throw new Error("no media query");
  const b = css.slice(i);
  if (!/animation:none!important/.test(b) || !/transition:none!important/.test(b)) throw new Error("global zero");
  if (!/\.row--own\{animation:none\}/.test(b)) throw new Error("own row");
  if (!/\[data-reveal\]\{opacity:1!important;transform:none!important\}/.test(b)) throw new Error("reveal");
  const js = read("src", "js", "main.js");
  if (!/prefers-reduced-motion: reduce/.test(js) || !/if \(reduced\(\)\)/.test(js)) throw new Error("js");
});
gate("motion kit present: spring reveal, parallax, spotlight, progress bar, live dot, skeleton fade stagger", () => {
  const js = read("src", "js", "main.js"), css = read("src", "css", "main.css");
  for (const [re, label, src] of [[/function springIn/, "spring", js], [/k = 170, c = 17/, "damped solver", js], [/data-depth/, "parallax", js], [/--mx/, "spotlight", js], [/data-progress/, "progress", js], [/@keyframes livePulse/, "live dot", css], [/\.fade-in\{[^}]*--k/, "stagger", css], [/\.blob/, "gradient mesh", css]])
    if (!re.test(src)) throw new Error("missing " + label);
});
gate("units: no ch units anywhere in css/js/html", () => {
  for (const f of textFiles(path.join(ROOT, "src"), [".css", ".js", ".html"])) if (/\d(\.\d+)?ch\b/.test(fs.readFileSync(f, "utf8"))) throw new Error(rel(f));
});
gate("tap targets: every interactive class declares at least 44px", () => {
  const css = read("src", "css", "main.css");
  const need = [".icon-btn", ".button", ".tab", ".copy-btn", ".ca__btn", ".nav a", ".brand"];
  for (const sel of need) {
    const re = new RegExp(sel.replace(/[.\s]/g, (c) => (c === "." ? "\\." : "\\s+")) + "\\{([^}]*)\\}", "g");
    const bodies = [...css.matchAll(re)].map((m) => m[1]).join(";");
    if (!/(min-height|height):(4[4-9]|[5-9]\d)px/.test(bodies)) throw new Error(sel + " lacks 44px height");
    if ((sel === ".icon-btn" || sel === ".copy-btn") && !/width:(4[4-9]|[5-9]\d)px/.test(bodies)) throw new Error(sel + " lacks 44px width");
  }
});
gate("reference copy: zero shared 2-grams with the reference site (stopword-only pairs and the chain name excepted)", () => {
  const ref = new Set(JSON.parse(read("scripts", "ref-bigrams.json")));
  const stop = new Set("a an the of to in on for and or with by at is it as be we you your our from that this are was not no so but if then than its into over per via out up".split(" "));
  const allow = new Set(["robinhood chain"]);
  const html = V.main.html;
  const title = (html.match(/<title>(.*?)<\/title>/) || [])[1] || "";
  const metas = [...html.matchAll(/<meta [^>]*content="([^"]*)"/g)].map((m) => m[1]).filter((c) => !/^#|^https?:|^website|^summary|^width=/.test(c));
  const text = (visibleText(html.replace(/<div class="ticker"[\s\S]*?<\/div>\s*<\/div>/, " ")) + " " + title + " " + metas.join(" ")).replace(/&amp;/g, "&");
  const w = text.toLowerCase().match(/[a-z0-9$']+/g) || [];
  const hits = [];
  for (let i = 0; i < w.length - 1; i++) {
    const bg = w[i] + " " + w[i + 1];
    if (allow.has(bg) || (stop.has(w[i]) && stop.has(w[i + 1]))) continue;
    if (ref.has(crypto.createHash("sha1").update(bg).digest("hex").slice(0, 10))) hits.push(bg);
  }
  if (hits.length) throw new Error([...new Set(hits)].join(" | "));
});
gate("repo hygiene: no agent config files or folders, no attribution strings, no tool mentions in any project file", () => {
  if (exists("CLA" + "UDE.md") || exists(".cla" + "ude")) throw new Error("forbidden file or folder");
  const pats = [["cla", "ude"], ["anthro", "pic"], ["co-auth", "ored"], ["generated ", "with"], ["gener", "ated by"]].map((p) => new RegExp(p.join(""), "i"));
  const aiWord = new RegExp("\\b" + "A" + "I\\b|\\b" + "A\\." + "I\\.|\\b" + "LL" + "M\\b");
  const bad = [];
  for (const f of walk(ROOT)) {
    const r = rel(f);
    if (/^(brand|reference)\//.test(r) || /\.(png|jpe?g|jpeg|woff2?)$/i.test(r)) continue;
    if (r.startsWith("src/assets/") && !/\.(svg|json)$/.test(r)) continue;
    const t = fs.readFileSync(f, "utf8");
    if (pats.some((p) => p.test(t)) || aiWord.test(t)) bad.push(r);
  }
  if (bad.length) throw new Error(bad.join(", "));
});
gate("repo content: README, whitepaper, MIT licence (ZIVILIA, 2026) at the root, none inside dist", () => {
  for (const f of ["README.md", "docs/whitepaper.md", "LICENSE"]) if (!exists(...f.split("/"))) throw new Error("missing " + f);
  const lic = read("LICENSE");
  if (!/^MIT License/.test(lic) || !/Copyright \(c\) 2026 ZIVILIA/.test(lic)) throw new Error("licence text");
  const rd = read("README.md");
  for (const s of ["Zivilia", "img.shields.io", "Robinhood Chain", "pending", "## Overview", "## Features", "## Links"]) if (!rd.includes(s)) throw new Error("README lacks " + s);
  const wp = read("docs", "whitepaper.md");
  for (const s of ["Vision and mission", "Tokenomics", "Roadmap", "Phase 1", "Phase 4", "Team"]) if (!wp.includes(s)) throw new Error("whitepaper lacks " + s);
});
gate("page shape: CA slot precedes hero; status pill, progress bar, five sections, footer present; title and favicon wired", () => {
  const h = V.main.html;
  if (h.indexOf('data-slot="ca"') > h.indexOf('class="hero-wrap"')) throw new Error("CA slot must come first");
  for (const s of ['class="progress"', 'class="status-pill"', 'id="studio"', 'id="playbooks"', 'id="board"', 'id="flow"', 'id="journal"', "<footer", 'rel="icon"', "Zivilia.fun"]) if (!h.includes(s)) throw new Error("missing " + s);
});

/* ---- run ---- */
let pass = 0, fail = 0;
try { await variants(); } catch (e) { console.error("variant build failed:", e.message); process.exit(1); }
for (const [i, g] of gates.entries()) {
  const label = String(i + 1).padStart(2, "0") + " " + g.name;
  try { await g.fn(); pass++; console.log("PASS " + label); } catch (e) { fail++; console.log("FAIL " + label + "\n     -> " + e.message); }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${gates.length} gates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
