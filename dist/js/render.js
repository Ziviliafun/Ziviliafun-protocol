// Pure string renderers shared by the build script and the browser.
// Every function reads the record it is handed; nothing here assumes a state.

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const LOGO_SRC = "assets/logo-mark-160.png";

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const isStated = (rec) => !!rec && rec.state === "stated";
export const recordByKind = (records, kind) => Object.values(records).filter((r) => r.kind === kind);

export function handleFromUrl(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0];
    return seg ? "@" + seg : "";
  } catch (e) {
    return "";
  }
}

const X_PATH =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
const GH_PATH =
  "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z";

const ICONS = {
  x: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="${X_PATH}"/></svg>`,
  github: `<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="${GH_PATH}"/></svg>`,
};

// Icon-only social link. Stated record: real anchor. Anything else: inert span, no href.
export function renderSocialIcon(key, rec, cls = "icon-btn") {
  const name = rec.label;
  if (isStated(rec) && rec.url) {
    const handle = handleFromUrl(rec.url);
    return `<a class="${cls}" data-social="${esc(key)}" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name + (handle ? " " + handle : ""))}">${ICONS[key]}</a>`;
  }
  return `<span class="${cls} is-inert" data-social="${esc(key)}" role="img" aria-disabled="true" aria-label="${esc(name)}, pending">${ICONS[key]}</span>`;
}

export function renderSocial(records, cls) {
  return renderSocialIcon("x", records.x, cls) + renderSocialIcon("github", records.github, cls);
}

// Contract-address slot. Both branches are always renderable.
export function renderCa(rec) {
  if (isStated(rec) && rec.value && ADDRESS_RE.test(rec.value)) {
    const v = esc(rec.value);
    return (
      `<div class="ca" data-state="stated">` +
      `<span class="ca__label">CA</span>` +
      `<button class="ca__btn" type="button" data-copy="${v}" aria-label="Copy contract address">` +
      `<code class="ca__addr">${v}</code>` +
      `<span class="ca__hint" data-copy-hint>Copy</span></button></div>`
    );
  }
  return (
    `<div class="ca" data-state="${esc(rec.state)}" aria-disabled="true">` +
    `<span class="ca__label">CA</span>` +
    `<div class="ca__btn is-inert"><code class="ca__addr ca__addr--ghost">· · · · · · · · · · · · · ·</code>` +
    `<span class="ca__hint">pending</span></div></div>`
  );
}

const shortAddr = (a) => a.slice(0, 6) + "…" + a.slice(-4);

// "Wiring" grid. Inert records show label + pending only.
export function renderInfra(records) {
  const chain = records.chain;
  const ca = records.ca;
  const gh = records.github;
  const item = (icon, label, body) =>
    `<div class="infra__item" data-spot><span class="infra__ico" aria-hidden="true">${icon}</span><span class="infra__label">${esc(label)}</span><strong>${body}</strong></div>`;
  const dot = '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
  const hash = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M9 4 7 20M17 4l-2 16M4 9h17M3 15h17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const key = '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="8" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12h9M18 12v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const code = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const out = [];
  out.push(item(dot, "Network", isStated(chain) ? esc(chain.label) : "pending"));
  out.push(item(hash, "Chain ID", isStated(chain) && chain.chainId ? esc(chain.chainId) : "pending"));
  out.push(item(key, "Contract", isStated(ca) && ca.value && ADDRESS_RE.test(ca.value) ? esc(shortAddr(ca.value)) : "pending"));
  out.push(item(code, "Code", isStated(gh) && gh.url ? esc(handleFromUrl(gh.url)) : "pending"));
  return out.join("");
}

export const logoTile =(alt = "") =>
  `<span class="tile tile--brand"><img src="${LOGO_SRC}" alt="${esc(alt)}" width="28" height="21" decoding="async"></span>`;

// Row #1 of the board when no address is stated: brand logo, dotted data, not clickable.
export function renderOwnPlaceholder() {
  return (
    `<li class="row row--own" data-own data-placeholder data-state="pending" aria-label="Zivilia, pending">` +
    `<span class="row__rank">1</span>` +
    `<span class="row__token">${logoTile()}<span class="row__id"><strong>Zivilia</strong><span class="muted">pending</span></span></span>` +
    `<span class="row__cell row__cell--price" data-col="price">· · · · ·</span>` +
    `<span class="row__cell row__cell--chg" data-col="chg">· · · · ·</span>` +
    `<span class="row__cell row__cell--vol" data-col="vol">· · · · ·</span>` +
    `<span class="row__cell row__cell--liq" data-col="liq">· · · · ·</span>` +
    `<span class="row__copy"></span></li>`
  );
}
