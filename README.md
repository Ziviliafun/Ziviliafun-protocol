# Zivilia

**Rule-driven desks for Robinhood Chain.** Sketch a playbook, rehearse it against past hourly candles, and read the reasoning behind every call.

[![Live site](https://img.shields.io/badge/live-zivilia.fun-6452d8)](https://zivilia.fun)

- **Chain:** Robinhood Chain (chain id `0x1237`, RPC `https://rpc.mainnet.chain.robinhood.com`)
- **Contract address:** _pending, will be announced here and on the site once published_

## Overview

Zivilia is the public site for a toolkit that turns plain rules into market agents. The page shows a live board of the busiest pools on Robinhood Chain, a pinned slot for the Zivilia token, and a preview of the Studio workflow.

## Features

- Live market board: top pools by 24h volume with logo, price, daily move, volume, liquidity and one-click symbol copy
- Ticker driven by the same feed, polling every minute, paused while the tab is hidden, with exponential backoff on failure
- Pinned first row for the Zivilia token, filled from a pair lookup the moment a contract address is recorded
- Contract-address slot with click-to-copy, inert until an address is stated
- Register of external facts (`src/data/register.json`): every link or address is one record with a state of `stated`, `absent` or `unconfirmed`; anything not stated renders inert
- Reduced-motion support for every animation

## Links

- X: https://x.com/zivilia
- GitHub: pending

## Develop

```bash
npm run assets   # optional: regenerate logo derivatives and favicon (needs Python, Pillow, numpy, opencv)
npm run build    # writes dist/
npm run gates    # build, then verify every standing rule against both contract-address branches
npm run serve    # serve dist/ on http://localhost:5173
```

Deploy by uploading the contents of `dist/`.

## Updating a fact

Edit its record in `src/data/register.json`, set `state` to `stated`, add the `value` or `url`, then rebuild. No source file needs touching.

## License

MIT, see [LICENSE](LICENSE).
