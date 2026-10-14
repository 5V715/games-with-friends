# Games with Friends ♥♠

Touch-first games to play with friends in the browser: **Rommé** (German
rummy), **UNO**, **Monopoly Deal**, the real-time arena game **Bomber Buben** and the versus block-stacking game **Stacked**. Players connect **peer-to-peer over WebRTC**; ICE (STUN/TURN) finds the path
between browsers, so game traffic never goes through a server.

- **Game client:** static HTML/CSS/JS in [`public/`](public/). No build step, no
  dependencies. Deployable to GitHub Pages.
- **Signaling server:** a tiny Node relay in [`server/`](server/), shipped as an
  **OCI image**. It only introduces players to each other with table codes, and is
  optional.

## Games

When you create a table (or practice against bots), pick one of these games. The
host can still switch in the lobby.

| Game | Players | In short |
| --- | --- | --- |
| **Rommé** | 2–6 | German rummy: sets and runs, 40 to come out, cutting the deck, Hand ×2, majority vote between rounds |
| **UNO** | 2–8 | Match color/number/symbol, Skip/Reverse/+2/Wild/Wild +4, call UNO or get caught (+2), first to 500 |
| **Bomber Buben** | 1–4 | Real-time bomb battle in the classic 15×13 arena, best of 3; on-screen D-pad with A/B (hold the phone sideways) or keyboard; items: bomb up, fire up, full fire, skate, kick, remote, skull; falling blocks after 2 minutes |
| **Stacked** | 1–4 | Versus falling blocks, best of 3: clear lines to send garbage, T-spins, combos, back-to-back; hold and 5-piece preview; the others' wells shown small (red flash + number when they clear, a streak shows where garbage goes); whole-screen touch gestures or keyboard |
| **Monopoly Deal** | 2–5 | Three complete property sets win; real street names (US/German edition by language), tap any card or set for its rent ladder; rent, Debt Collector, Birthday, Sly/Forced Deal, Deal Breaker, Just Say No, houses/hotels |

Every game runs on the host's browser, has bots, works in German and English, and
supports push to talk. UNO and Monopoly Deal are trademarks of Mattel and Hasbro.
This is a private fan implementation with its own card designs.

## Features

- Touch-first UI: tap to select, drag to reorder your hand, drag onto melds or the
  discard pile. Large touch targets, haptics, safe-area aware, installable (PWA manifest).
- Full Rommé rules: 110 cards (2 decks + 6 jokers), sets and runs, ace low/high,
  40-point first meld, laying off, joker swapping, Hand-Rommé (double penalty),
  voting on another round, and a score sheet.
- Host-authoritative networking: the host's browser runs the game and sends each
  player only their own hand. The real-time game simulates 60 ticks per second on
  the host; input and frames (20 per second, interpolated) use a second, unordered
  data channel without retransmits, so a lost packet never stalls the game.
- Three ways to play:
  1. **Table code** via the signaling server, with trickle ICE and automatic ICE restart.
  2. **Invite codes** you copy and paste. No server at all: the SDP offer/answer is
     compressed into a short code you can send over any chat.
  3. **Practice** offline against bots.
- German and English. The language follows the browser, and any other browser
  language falls back to English. You can change it under **Settings → Language** or
  with `?lang=de` / `?lang=en`. Game messages are translated on each device, so
  players at the same table can use different languages.
- Connection status per player (direct P2P vs. TURN relay, round-trip time).
- Push to talk: hold 🎤 to record a short voice message (up to 15 s). It is sent
  peer-to-peer to everyone at the table and plays right away. This needs HTTPS and
  microphone permission.
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
| `public/js/main.js` | Screens, lobby, Rommé UI, touch interaction |
| `public/js/games/index.js` | Registry of the games (engine, bot, rules, player limits) |
| `public/js/games/uno/` | UNO: engine, bot, screen, texts |
| `public/js/games/deal/` | Monopoly Deal: cards, engine, bot, screen, texts |
| `public/js/games/stacked/` | Stacked: the well (pieces, rotation, garbage), referee engine with bots, screen, texts |
| `public/js/games/bomber/` | Bomber Buben: 60 Hz engine, bot, canvas screen with touch controls, texts |
| `public/js/ui-kit.js` | Choice and multi-select sheets used by the game screens |
| `public/js/i18n.js` | German and English texts, language detection |
| `public/js/voice.js` | Push-to-talk recording, chunking and playback |
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
   `SIGNALING_URL` with your signaling server's URL (for example `https://games-signal.example.com`).
3. Push to `main`. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) writes
   `config.js` and publishes `public/`.

If `SIGNALING_URL` isn't set, the game still works with copy/paste invite codes.
Players can also point the game at a server with `?signal=https://…` or in
**Connection settings**.

### Signaling server → OCI image

[`.github/workflows/server-image.yml`](.github/workflows/server-image.yml) builds a
multi-arch (amd64, arm64 and arm/v7 – e.g. Raspberry Pi with 64- or 32-bit OS) OCI image and pushes it to
`ghcr.io/<owner>/games-with-friends` on every push and for `v*` tags. Every image is
tagged with its branch name (e.g. `:bomber`; a `/` becomes `-`); `main` also gets `:latest`.

Build and run it yourself:

```sh
docker build -t games-with-friends -f server/Containerfile .   # from the repo root; or: podman build …
docker run -p 8080:8080 \
  -e ALLOWED_ORIGINS=https://<you>.github.io \
  games-with-friends
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
| `SERVE_GAME` | `true` in the image | Also serves the game page itself, so the container works without GitHub Pages: open `http://<server>:8080/`. `false` turns this off. |
| `PUBLIC_DIR` | `./public` | Where the game's files are |
| `ADMIN_TOKEN` | – | Enables `GET /admin/rooms`, which lists all rooms. Unset means the endpoint is off. |
| `ROOM_IDLE_MINUTES` | `120` | Closes a room after this many minutes without signaling activity (joins, offers, ICE candidates). `0` turns it off. Games already running stay connected because they talk peer-to-peer, but new players can't join that room any more. |

Endpoints: `GET /healthz` (room count only), `GET /api/ice`, `GET /api/signal` (SSE),
`POST /api/signal`, and `GET /admin/rooms` (needs `ADMIN_TOKEN`).
Rooms are held in memory, so run a single replica.

A room disappears as soon as its last player disconnects, or after
`ROOM_IDLE_MINUTES` without activity. To list the open rooms:

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-server.example.com/admin/rooms
```

```json
{ "rooms": [ { "room": "K7QXP", "players": 3, "hostConnected": true,
  "createdAt": "…", "lastActivity": "…", "ageMinutes": 12, "idleMinutes": 4,
  "expiresInMinutes": 116 } ], "idleMinutes": 120 }
```

### All in one container (no GitHub Pages)

The image also contains the game. Run it and open the server's address in the
browser. The page notices that its own server offers signaling, so you don't
need a `SIGNALING_URL` or `?signal=` parameter. Microphone access (push to talk)
needs HTTPS, so put the container behind a TLS proxy for use on phones.

### Behind Traefik

Only container port **8080** (HTTP) is needed. Traefik reaches it over the
Docker network, so you don't publish any ports. Game traffic and voice go
browser to browser over WebRTC and never touch the server.

```yaml
services:
  games:
    image: ghcr.io/5v715/games-with-friends:latest
    restart: unless-stopped
    environment:
      ALLOWED_ORIGINS: https://5v715.github.io   # only needed if the GitHub Pages copy should use this server too
      ADMIN_TOKEN: change-me
      ROOM_IDLE_MINUTES: "120"
    networks: [traefik]
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik
      - traefik.http.routers.games.rule=Host(`games.example.com`)
      - traefik.http.routers.games.entrypoints=websecure
      - traefik.http.routers.games.tls.certresolver=letsencrypt
      - traefik.http.services.games.loadbalancer.server.port=8080
networks:
  traefik:
    external: true
```

Run a single instance, because rooms live in memory. Signaling uses Server-Sent
Events, which Traefik streams without extra configuration.

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
- Whoever goes out first scores 0. Everyone else scores the cards still in their
  hand: numbers their face value, pictures 10, ace 11, joker 20. If someone goes out
  in a single turn while nobody was out yet, that's a **Hand** and all points of the
  round count double.
- After each round everybody votes on another round. The majority decides, and a tie
  means play on. The score sheet (📊) shows every round. When the game ends, the
  lowest total wins.

## Limitations

- The host's browser is the game server. If the host closes the tab, the game ends.
- Signaling rooms live in server memory, so the server can only run as one instance.
