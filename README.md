# Rommé ♥♠

A touch-first, browser-based **Rommé** (German rummy) card game for 2–6 players.
Players connect **peer-to-peer over WebRTC**; ICE (STUN/TURN) finds the path
between browsers, so game traffic never goes through a server.

- **Game client:** static HTML/CSS/JS in [`public/`](public/). No build step, no
  dependencies. Deployable to GitHub Pages.
- **Signaling server:** a tiny Node relay in [`server/`](server/), shipped as an
  **OCI image**. It only introduces players to each other with table codes, and is
  optional.

## Features

- Touch-first UI: tap to select, drag to reorder your hand, drag onto melds or the
  discard pile. Large touch targets, haptics, safe-area aware, installable (PWA manifest).
- Full Rommé rules: 110 cards (2 decks + 6 jokers), sets and runs, ace low/high,
  40-point first meld, laying off, joker swapping, Hand-Rommé (double penalty),
  multi-round scoring.
- Host-authoritative networking: the host's browser runs the game and sends each
  player only their own hand.
- Three ways to play:
  1. **Table code** via the signaling server, with trickle ICE and automatic ICE restart.
  2. **Invite codes** you copy and paste. No server at all: the SDP offer/answer is
     compressed into a short code you can send over any chat.
  3. **Practice** offline against bots.
- Connection status per player (direct P2P vs. TURN relay, round-trip time).
- Bots fill seats; a disconnected player is auto-played until they rejoin. If a
  guest reloads the page, they get their seat back.
- Optional custom TURN server and "relay only" mode in the in-app settings.

## Architecture

```
 GitHub Pages (static)            OCI container (optional)
 ┌──────────────────┐   SSE+POST  ┌──────────────────────┐
 │ public/index.html│◀──────────▶│ server/server.js     │  SDP + ICE candidates only
 └──────────────────┘             └──────────────────────┘
          ▲
          │ WebRTC data channel (direct, or TURN relay)
          ▼
   host browser ◀──▶ guest browsers   (star topology, host runs engine.js)
```

| File | Purpose |
| --- | --- |
| `public/js/cards.js` | Deck, shuffle (crypto RNG), card values |
| `public/js/rules.js` | Meld validation, lay-off, joker swap |
| `public/js/engine.js` | Authoritative game state and turn flow |
| `public/js/bot.js` | Computer player |
| `public/js/net.js` | WebRTC/ICE links, signaling client, invite codes |
| `public/js/session.js` | Host/guest sessions between the engine and the network |
| `public/js/main.js` | UI rendering and touch interaction |
| `public/config.js` | `SIGNALING_URL` for the deployed site |
| `server/server.js` | Signaling relay (no dependencies) |
| `server/Containerfile` | OCI image definition |

## Run locally

Requires Node 18+.

```sh
npm run dev      # game on :5173, signaling server on :8080
npm test         # rules, engine, and bot simulation tests
```

Open <http://localhost:5173/?signal=http://localhost:8080> in two browser windows.
On a phone on the same network, use your computer's IP address instead of `localhost`.

## Deploy

### Game → GitHub Pages

1. Under **Settings → Pages**, set **Source: GitHub Actions**.
2. Optional: under **Settings → Secrets and variables → Actions → Variables**, add
   `SIGNALING_URL` with your signaling server's URL (for example `https://romme-signal.example.com`).
3. Push to `main`. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) writes
   `config.js` and publishes `public/`.

If `SIGNALING_URL` isn't set, the game still works with copy/paste invite codes.
Players can also point the game at a server with `?signal=https://…` or in
**Connection settings**.

### Signaling server → OCI image

[`.github/workflows/server-image.yml`](.github/workflows/server-image.yml) builds a
multi-arch (amd64, arm64 and arm/v7 – e.g. Raspberry Pi with 64- or 32-bit OS) OCI image and pushes it to
`ghcr.io/<owner>/romme-signaling` on every push to `main` and for `v*` tags.

Build and run it yourself:

```sh
docker build -t romme-signaling -f server/Containerfile server   # or: podman build …
docker run -p 8080:8080 \
  -e ALLOWED_ORIGINS=https://<you>.github.io \
  romme-signaling
```

The page is served over HTTPS on GitHub Pages, so put the server behind TLS (a
reverse proxy, Cloud Run, Fly.io, etc.). Browsers block an `http://` signaling URL
on an `https://` page.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `ALLOWED_ORIGINS` | `*` | Comma-separated origins allowed by CORS, e.g. `https://you.github.io` |
| `ICE_SERVERS` | Google STUN | JSON array of `RTCIceServer` objects sent to clients |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | – | Adds a TURN server (e.g. coturn) to the list |

Endpoints: `GET /healthz`, `GET /api/ice`, `GET /api/signal` (SSE), `POST /api/signal`.
Rooms are held in memory, so run a single replica.

### About TURN

STUN is enough for most home networks. Behind symmetric NATs or strict corporate
firewalls, a direct path can't be found and a TURN relay is needed. Configure one
on the server (`TURN_URL` …) or per device in **Connection settings**.

## Rules (short)

Everyone gets 12 cards; the starting player gets a 13th and opens by discarding
instead of drawing. On your turn: **draw** (from the stock, or from the discard pile once you are out),
optionally **meld**, then **discard**.

- **Set:** 3–4 cards of the same rank in different suits.
- **Run:** 3 or more consecutive cards of the same suit. An ace can be low (A-2-3)
  or high (Q-K-A), but a run can't wrap around (K-A-2).
- A **joker** can stand in for any card.
- Your **first meld** must total at least 40 points: 2–10 count face value, J/Q/K
  count 10, an ace counts 11 (or 1 in A-2-3). After that, and only on your own turn, you
  can take from the discard pile, lay cards off on any meld, and swap a joker for the
  real card it represents if you hold it.
- You can't throw back the card you just picked up from the discard pile.
- The first player with no cards left wins the round. Everyone else scores the
  cards still in their hand as penalty points: joker 20, ace 11, face cards 10,
  others face value. These double if the winner went out in a single turn
  (**Hand-Rommé**). The lowest total score wins.

## Limitations

- The host's browser is the game server. If the host closes the tab, the game ends.
- Signaling rooms live in server memory, so the server can only run as one instance.
