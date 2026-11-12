// Market data. Knows nothing about the contract-address record: the only input is the
// market-source record's url.

const num = (v) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};
const goodImg = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

// GeckoTerminal trending_pools?include=base_token,quote_token -> rows
export function parseTrending(json) {
  const tokens = new Map();
  for (const inc of json?.included || []) {
    if (inc.type === "token") tokens.set(inc.id, inc.attributes || {});
  }
  const byToken = new Map();
  for (const pool of json?.data || []) {
    const a = pool.attributes || {};
    const id = pool.relationships?.base_token?.data?.id;
    if (!id) continue;
    const t = tokens.get(id) || {};
    const row = {
      id,
      address: (t.address || id.split("_").pop() || "").toLowerCase(),
      symbol: t.symbol || (a.name || "").split("/")[0].trim() || "?",
      name: t.name || "",
      logo: goodImg(t.image_url),
      price: num(t.price_usd) ?? num(a.base_token_price_usd),
      change: num(a.price_change_percentage?.h24),
      volume: num(a.volume_usd?.h24),
      liquidity: num(a.reserve_in_usd),
    };
    const prev = byToken.get(id);
    if (!prev || (row.volume ?? -1) > (prev.volume ?? -1)) byToken.set(id, row);
  }
  return [...byToken.values()];
}

export const topByVolume = (rows, n = 10) =>
  [...rows].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)).slice(0, n);

// DexScreener tokens/{CA}: best pair by 24h volume
export function parseDex(json, address) {
  const pairs = (json?.pairs || []).filter(Boolean);
  if (!pairs.length) return null;
  const p = [...pairs].sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0];
  return {
    id: "own",
    address: String(address).toLowerCase(),
    symbol: p.baseToken?.symbol || "ZIVILIA",
    name: p.baseToken?.name || "Zivilia",
    logo: null, // own logo always comes from brand assets
    price: num(p.priceUsd),
    change: num(p.priceChange?.h24),
    volume: num(p.volume?.h24),
    liquidity: num(p.liquidity?.usd),
  };
}

// Pinned own row + trending rows 2..10, own token removed from the trending list.
export function composeBoard(own, trending, total = 10) {
  const ownAddr = own?.address;
  const rest = trending.filter((r) => !ownAddr || r.address !== ownAddr);
  return { own: own || null, rows: rest.slice(0, total - 1) };
}

export async function getJson(url, { signal, timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  if (signal) signal.addEventListener("abort", () => ctl.abort(), { once: true });
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("http " + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Exponential backoff with jitter, capped.
export const backoffDelay = (attempt, base = 2000, cap = 60000) =>
  Math.min(cap, base * 2 ** Math.max(0, attempt - 1)) * (0.85 + Math.random() * 0.3);

// Poller: every `every` ms, paused while hidden, immediate on visible, backoff after failures.
export function createPoller({ run, every = 60000, onState }) {
  let timer = null, failures = 0, stopped = false, inflight = false;
  const clear = () => { clearTimeout(timer); timer = null; };
  const schedule = (ms) => { clear(); if (!stopped && !document.hidden) timer = setTimeout(tick, ms); };
  async function tick() {
    if (inflight || document.hidden) return;
    inflight = true;
    try {
      await run();
      failures = 0;
      onState?.({ ok: true, failures });
      schedule(every);
    } catch (e) {
      failures += 1;
      onState?.({ ok: false, failures });
      schedule(Math.min(every, backoffDelay(failures)));
    } finally {
      inflight = false;
    }
  }
  const onVis = () => (document.hidden ? clear() : tick());
  document.addEventListener("visibilitychange", onVis);
  tick();
  return { stop() { stopped = true; clear(); document.removeEventListener("visibilitychange", onVis); }, tick };
}

// Formatting
export function fmtUsd(v) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toFixed(2);
}
export function fmtPrice(v) {
  if (v == null) return "—";
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return "$" + v.toFixed(2);
  if (v >= 0.01) return "$" + v.toFixed(4);
  if (v === 0) return "$0";
  const s = v.toFixed(12).replace(/0+$/, "");
  const m = s.match(/^0\.(0*)(\d{1,4})/);
  return m ? "$0." + m[1] + m[2] : "$" + v.toPrecision(3);
}
export function fmtPct(v) {
  if (v == null) return "—";
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%";
}
