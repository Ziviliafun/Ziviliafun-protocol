import { renderCa, renderSocial, renderInfra, renderOwnPlaceholder, logoTile, isStated, recordByKind, ADDRESS_RE, esc } from "./render.js";
import { parseTrending, topByVolume, parseDex, composeBoard, getJson, createPoller, fmtUsd, fmtPrice, fmtPct } from "./market.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceQ = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => reduceQ.matches;

const register = JSON.parse($("#register").textContent);
const R = register.records;

/* ---------- slots (state read at runtime) ---------- */
function hydrateSlots() {
  const ca = recordByKind(R, "address")[0];
  if (ca) $('[data-slot="ca"]').innerHTML = renderCa(ca);
  $('[data-slot="social"]').innerHTML = renderSocial(R);
  $('[data-slot="social2"]').innerHTML = renderSocial(R);
  $('[data-slot="social3"]').innerHTML = renderSocial(R);
  $('[data-slot="infra"]').innerHTML = renderInfra(R);
}
hydrateSlots();

/* ---------- copy ---------- */
const COPY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { /* ignore */ }
    ta.remove(); return ok;
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const text = b.getAttribute("data-copy");
  if (!text) return;
  const ok = await copyText(text);
  const hint = $("[data-copy-hint]", b);
  b.classList.toggle("is-copied", ok);
  if (hint) hint.textContent = ok ? "Copied" : "Press Ctrl+C";
  if (b.classList.contains("copy-btn")) b.innerHTML = ok ? CHECK_ICON : COPY_ICON;
  $("[data-live]").textContent = ok ? "Copied to clipboard" : "Copy failed";
  clearTimeout(b._t);
  b._t = setTimeout(() => {
    b.classList.remove("is-copied");
    if (hint) hint.textContent = "Copy";
    if (b.classList.contains("copy-btn")) b.innerHTML = COPY_ICON;
  }, 1600);
});

/* ---------- scroll progress ---------- */
const bar = $("[data-progress]");
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    settleSkipped();
    ticking = false;
  });
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* ---------- spring reveal (damped solver) ---------- */
function springIn(el, delay) {
  if (reduced()) { el.classList.add("is-in"); return; }
  const k = 170, c = 17; // stiffness, damping: slightly underdamped
  let x = 0, v = 0, last = null;
  setTimeout(() => {
    requestAnimationFrame(function step(t) {
      if (last == null) last = t;
      let dt = Math.min(0.05, (t - last) / 1000); last = t;
      const n = Math.ceil(dt / 0.008);
      for (let i = 0; i < n; i++) { const h = dt / n; v += (-k * (x - 1) - c * v) * h; x += v * h; }
      el.style.opacity = Math.max(0, Math.min(1, x * 1.15));
      el.style.transform = `translateY(${(1 - x) * 28}px)`;
      if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.01) {
        el.style.opacity = ""; el.style.transform = ""; el.classList.add("is-in"); return;
      }
      requestAnimationFrame(step);
    });
  }, delay);
}
const io = new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target); pending.delete(e.target);
    springIn(e.target, (parseInt(getComputedStyle(e.target).getPropertyValue("--i")) || 0) * 80);
  }
}, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
const pending = new Set($$("[data-reveal]"));
pending.forEach((el) => io.observe(el));
// A fast jump (anchor link, scrollbar drag) can pass an element without it ever intersecting: settle those instantly.
function settleSkipped() {
  for (const el of pending) {
    if (el.getBoundingClientRect().bottom < 0) { io.unobserve(el); el.classList.add("is-in"); pending.delete(el); }
  }
}

/* ---------- parallax (pointer + scroll) ---------- */
const layers = $$("[data-depth]");
let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
function par() {
  cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
  const sy = Math.min(scrollY, 900);
  for (const l of layers) {
    const d = parseFloat(l.dataset.depth);
    l.style.setProperty("--px", (cx * d * 28).toFixed(2) + "px");
    l.style.setProperty("--py", (cy * d * 18 - sy * d * 0.12).toFixed(2) + "px");
  }
  raf = Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001 ? requestAnimationFrame(par) : 0;
}
const kick = () => { if (!raf && !reduced()) raf = requestAnimationFrame(par); };
$(".hero-wrap").addEventListener("pointermove", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2; kick();
});
addEventListener("scroll", kick, { passive: true });

/* ---------- spotlight ---------- */
document.addEventListener("pointermove", (e) => {
  const t = e.target.closest?.("[data-spot]");
  if (!t) return;
  const r = t.getBoundingClientRect();
  t.style.setProperty("--mx", e.clientX - r.left + "px");
  t.style.setProperty("--my", e.clientY - r.top + "px");
}, { passive: true });

/* ---------- number tween + flash ---------- */
function tween(el, to, fmt, from = 0, dur = 900) {
  cancelAnimationFrame(el._raf);
  if (reduced() || to == null || from == null) { el.textContent = fmt(to); el._v = to; return; }
  const t0 = performance.now();
  (function f(t) {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) el._raf = requestAnimationFrame(f); else el.textContent = fmt(to);
  })(t0);
  el._v = to;
}
function setNum(el, v, fmt, opts = {}) {
  const prev = el._v;
  if (v == null) { el.textContent = "—"; el._v = null; return; }
  if (prev === v) return;
  if (prev == null) tween(el, v, fmt, 0, 900);
  else {
    tween(el, v, fmt, prev, 600);
    const cls = v > prev ? "cell-flash-up" : "cell-flash-down";
    el.classList.remove("cell-flash-up", "cell-flash-down"); void el.offsetWidth;
    if (!reduced()) el.classList.add(cls);
    opts.flashRow?.(v > prev);
  }
}

/* ---------- tabs ---------- */
const state = { trending: [], pools: 0, own: null, ownStatus: "idle", tab: "volume", market: "busy", hasData: false, err: false };
$$("[data-tabs]").forEach((box) => {
  const tabs = $$(".tab", box);
  const select = (t) => {
    tabs.forEach((x) => { const on = x === t; x.classList.toggle("is-on", on); x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; });
    if (box.dataset.tabs === "board") { state.tab = t.dataset.tab; renderBoard(); }
  };
  tabs.forEach((t, i) => {
    t.tabIndex = t.classList.contains("is-on") ? 0 : -1;
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); select(n);
    });
  });
});

/* ---------- board ---------- */
const rowsEl = $("[data-rows]");
const msgEl = $("[data-board-msg]");
const dotEl = $("[data-dot]");
const statusText = $("[data-status-text]");
const tickerTrack = $("[data-ticker-track]");

function setStatus() {
  const m = state.market;
  dotEl.className = "live-dot " + (m === "ok" ? "is-live" : m === "down" ? "is-down" : "is-busy");
  statusText.textContent = m === "ok" ? "Live market feed" : m === "down" ? "Feed offline, retrying" : "Syncing the feed";
  msgEl.classList.toggle("is-err", m === "down");
  msgEl.textContent = m === "ok" ? "Showing the busiest pools on the chain." :
    m === "down" ? (state.hasData ? "Source unreachable. Keeping the last good data and retrying." : "Source unreachable. Retrying with backoff.") : "Loading the board.";
}

function letterTile(sym) { return `<span class="tile" data-letter>${esc((sym || "?").slice(0, 1).toUpperCase())}</span>`; }
function tokenTile(r) {
  if (r.id === "own") return logoTile();
  return r.logo ? `<span class="tile"><img src="${esc(r.logo)}" alt="" width="36" height="36" loading="lazy" referrerpolicy="no-referrer" decoding="async"></span>` : letterTile(r.symbol);
}
function buildRow(r, rank, k) {
  const li = document.createElement("li");
  li.className = r.id === "own" ? "row row--own" : "row fade-in";
  li.dataset.id = r.id; li.dataset.spot = ""; li.style.setProperty("--k", k);
  if (r.id === "own") li.dataset.own = "";
  li.innerHTML =
    `<span class="row__rank"></span>` +
    `<span class="row__token">${tokenTile(r)}<span class="row__id"><strong>${esc(r.symbol)}</strong><span class="muted">${esc(r.name || "")}</span></span></span>` +
    `<span class="row__cell row__cell--price" data-col="price">—</span>` +
    `<span class="row__cell row__cell--chg" data-col="chg">—</span>` +
    `<span class="row__cell row__cell--vol" data-col="vol">—</span>` +
    `<span class="row__cell row__cell--liq" data-col="liq">—</span>` +
    `<span class="row__copy"><button class="copy-btn" type="button" data-copy="${esc(r.symbol)}" aria-label="Copy symbol ${esc(r.symbol)}">${COPY_ICON}</button></span>`;
  const img = $("img", li);
  if (img) img.addEventListener("error", () => { img.parentElement.outerHTML = letterTile(r.symbol); }, { once: true });
  return li;
}
function fillRow(li, r, rank) {
  $(".row__rank", li).textContent = rank;
  const flashRow = (up) => { li.classList.remove("flash-up", "flash-down"); void li.offsetWidth; if (!reduced()) li.classList.add(up ? "flash-up" : "flash-down"); };
  setNum($('[data-col="price"]', li), r.price, fmtPrice, { flashRow });
  const chg = $('[data-col="chg"]', li);
  setNum(chg, r.change, fmtPct);
  chg.classList.toggle("up", (r.change ?? 0) > 0); chg.classList.toggle("down", (r.change ?? 0) < 0); chg.classList.toggle("flat", !r.change);
  setNum($('[data-col="vol"]', li), r.volume, fmtUsd);
  setNum($('[data-col="liq"]', li), r.liquidity, fmtUsd);
}

function ownRowData() {
  if (!state.own) return null;
  return state.own;
}

function renderBoard() {
  const caRec = recordByKind(R, "address")[0];
  const ownStated = caRec && isStated(caRec) && ADDRESS_RE.test(caRec.value || "");
  let list = [...state.trending];
  if (state.tab === "movers") list.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  const { own, rows } = composeBoard(ownRowData(), list);

  // pinned row
  let ownEl = $("[data-own]", rowsEl);
  if (!ownStated) {
    if (!ownEl || !ownEl.hasAttribute("data-placeholder")) { ownEl?.remove(); rowsEl.insertAdjacentHTML("afterbegin", renderOwnPlaceholder()); ownEl = $("[data-own]", rowsEl); }
  } else {
    const base = own || { id: "own", symbol: "ZIVILIA", name: R.chain?.label ? "Zivilia" : "Zivilia", logo: null };
    if (!ownEl || ownEl.hasAttribute("data-placeholder")) { ownEl?.remove(); ownEl = buildRow(base, 1, 0); ownEl.dataset.state = state.ownStatus; rowsEl.prepend(ownEl); }
    ownEl.dataset.state = state.ownStatus;
    $(".row__rank", ownEl).textContent = 1;
    if (own) fillRow(ownEl, own, 1);
    else if (state.ownStatus === "err") $$("[data-col]", ownEl).forEach((c) => (c.textContent = "—"));
    else $$("[data-col]", ownEl).forEach((c) => { if (c._v == null) c.textContent = "· · · · ·"; });
  }

  // trending rows 2..10
  $$(".row--skel", rowsEl).forEach((s) => s.remove());
  $$(".row--err", rowsEl).forEach((s) => s.remove());
  if (!rows.length) {
    if (state.market === "down") for (let i = 0; i < 9; i++) rowsEl.insertAdjacentHTML("beforeend", `<li class="row row--err"><span class="row__rank">${i + 2}</span><span class="row__token"><span class="tile">—</span><span class="row__id"><strong>—</strong><span class="muted">no data</span></span></span><span class="row__cell">—</span><span class="row__cell">—</span><span class="row__cell row__cell--vol">—</span><span class="row__cell row__cell--liq">—</span><span class="row__copy"></span></li>`);
    else for (let i = 0; i < 9; i++) rowsEl.insertAdjacentHTML("beforeend", `<li class="row row--skel"><span class="skel skel--w60"></span></li>`);
    return;
  }
  const existing = new Map($$(".row[data-id]", rowsEl).filter((x) => x !== ownEl).map((x) => [x.dataset.id, x]));
  const keep = new Set(rows.map((r) => r.id));
  existing.forEach((el, id) => { if (!keep.has(id)) { el.remove(); existing.delete(id); } });
  let prev = ownEl;
  rows.forEach((r, i) => {
    let el = existing.get(r.id);
    if (!el) el = buildRow(r, i + 2, i);
    if (prev.nextElementSibling !== el) prev.after(el);
    fillRow(el, r, i + 2);
    prev = el;
  });
}

/* ticker */
let tickSig = "";
function renderTicker() {
  const rows = state.trending;
  if (!rows.length) return;
  const sig = rows.map((r) => r.id).join("|");
  const item = (r) => `<span class="ticker__item" data-tid="${esc(r.id)}"><b>${esc(r.symbol)}</b><span data-tp>${fmtPrice(r.price)}</span><span class="${(r.change ?? 0) > 0 ? "up" : (r.change ?? 0) < 0 ? "down" : "flat"}" data-tc>${fmtPct(r.change)}</span></span>`;
  if (sig !== tickSig) {
    tickSig = sig;
    const once = rows.map(item).join("");
    tickerTrack.innerHTML = once + once;
    tickerTrack.classList.add("fade-in");
  } else {
    for (const r of rows) $$(`[data-tid="${CSS.escape(r.id)}"]`, tickerTrack).forEach((el) => {
      $("[data-tp]", el).textContent = fmtPrice(r.price);
      const c = $("[data-tc]", el); c.textContent = fmtPct(r.change);
      c.className = (r.change ?? 0) > 0 ? "up" : (r.change ?? 0) < 0 ? "down" : "flat";
    });
  }
}

/* stats */
function renderStats() {
  const rows = state.trending;
  const sum = rows.reduce((a, r) => a + (r.volume || 0), 0);
  const big = rows.reduce((m, r) => (Math.abs(r.change ?? 0) > Math.abs(m ?? 0) ? r.change : m), rows[0]?.change ?? null);
  const set = (k, v, f) => setNum($(`[data-stat="${k}"]`), v, f);
  set("pools", rows.length ? state.pools : null, (v) => Math.round(v).toString());
  set("volume", rows.length ? sum : null, fmtUsd);
  set("move", rows.length ? big : null, fmtPct);
  set("tokens", rows.length ? rows.length : null, (v) => Math.round(v).toString());
}

function renderAll() { setStatus(); renderBoard(); renderTicker(); renderStats(); }

/* ---------- market poller: follows the market-source record only ---------- */
const mrec = R.marketSource;
if (isStated(mrec) && mrec.url) {
  createPoller({
    every: 60000,
    run: async () => {
      const json = await getJson(mrec.url);
      const all = parseTrending(json);
      const top = topByVolume(all, 10);
      if (!top.length) throw new Error("empty");
      state.trending = top; state.pools = Array.isArray(json.data) ? json.data.length : top.length;
      state.hasData = true; state.market = "ok"; renderAll();
    },
    onState: ({ ok }) => { if (!ok) { state.market = "down"; renderAll(); } },
  });
} else { state.market = "down"; renderAll(); }

/* ---------- own token: only when the address record is stated ---------- */
const caRec = recordByKind(R, "address")[0];
const pairRec = R.pairSource;
if (caRec && isStated(caRec) && ADDRESS_RE.test(caRec.value || "") && isStated(pairRec) && pairRec.url) {
  state.ownStatus = "pending";
  renderBoard();
  createPoller({
    every: 60000,
    run: async () => {
      const json = await getJson(pairRec.url + encodeURIComponent(caRec.value));
      const own = parseDex(json, caRec.value);
      if (!own) throw new Error("no pair");
      state.own = own; state.ownStatus = "ok"; renderBoard();
    },
    onState: ({ ok }) => { if (!ok && !state.own) { state.ownStatus = "err"; renderBoard(); } },
  });
} else {
  renderBoard();
}
reduceQ.addEventListener?.("change", () => { if (reduced()) $$("[data-reveal]").forEach((e) => e.classList.add("is-in")); });
