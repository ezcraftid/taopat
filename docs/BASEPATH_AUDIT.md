# Base-Path / Reverse-Proxy Audit

Phase 1 deliverable for making TaoPat work both at the origin root
(`https://taopat.deni26.games/`) and under a sub-path
(`https://deni26.games/TaoPat/`).

The app must never assume that the **public origin/path** equals the
**origin server address**. All routing and URL generation must derive from
one configured base path plus the request's standard forwarding headers.

---

## 1. Deployment modes

| Mode | Public URL | Origin request seen by Node | Notes |
| --- | --- | --- | --- |
| Root (direct) | `https://taopat.deni26.games/` | `GET /...` | Current production setup. |
| Sub-path, Worker strips prefix (case A) | `https://deni26.games/TaoPat/...` | `GET /...` | Recommended. Origin stays root-based. |
| Sub-path, Worker keeps prefix (case B) | `https://deni26.games/TaoPat/...` | `GET /TaoPat/...` | Server must accept and strip its own base prefix. |

Both sub-path cases must work. The server therefore normalizes the incoming
path against the configured `BASE_PATH` instead of assuming either shape.

`BASE_PATH` values: `""` / `"/"` (root) or `/TaoPat` (no trailing slash,
leading slash required). Normalization is centralized.

---

## 2. URL classes

Every URL the app produces must fall into exactly one class:

| Class | Examples | Rule |
| --- | --- | --- |
| **Asset** | `assets/img/tao-base.png`, `assets/audio/*`, `css/*`, `js/*` | Document-relative. Resolved by `TaoCore.assetUrl()` against `document.baseURI`. Works at any base. |
| **App route** | `/healthz`, `/api/status`, `/socket.io/*` | Base-aware. Resolved by a new `appUrl()` / `withBase()` helper using `BASE_PATH`. |
| **Absolute / external** | `https://deni26.my.id/`, `data:`, `//cdn` | Returned unchanged. |

The current `resolveAssetUrl()` intentionally leaves any leading `/` untouched
(it treats it as an intentional server route). That is correct for assets but
insufficient for app routes under a sub-path, which is why a separate
base-aware helper is needed rather than overloading `assetUrl()`.

---

## 3. Findings

Severity: **High** = breaks the sub-path deployment, **Med** = wrong/ambiguous
behavior, **Low** = documentation or hardening only.

| # | Severity | File:line | Current | Impact under `/TaoPat/` | Fix | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | High | `public/js/fx.js:7-8` | `IMG_DIR = "/assets/img/"`, `AUDIO_DIR = "/assets/audio/"` | Browser requests `https://deni26.games/assets/...` (outside `/TaoPat/`) → 404, no images/audio. | Make them document-relative (`"assets/img/"`, `"assets/audio/"`) and route through `TaoCore.assetUrl()`. | 4 |
| F2 | High | `public/js/fx.js:346,358,363` | `probe.src = IMG_DIR + file`, `url("${IMG_DIR + file}")` | Inherits F1. | Use the base-aware asset helper for probe and sprite background. | 4 |
| F3 | High | `public/index.html:214` | `<script src="/socket.io/socket.io.js">` | Requests `https://deni26.games/socket.io/socket.io.js` (outside prefix) → 404. | Serve the client at `<BASE_PATH>/socket.io/socket.io.js` and load it document-relative (`socket.io/socket.io.js`) with the server `path` set to the base. | 3, 4 |
| F4 | High | `public/js/app.js:33-37` | `io({ auth: { clientId } })` (default path `/socket.io`) | Connects to `/socket.io` at the public root, not `/TaoPat/socket.io`. | Pass `path: TaoCore.appUrl("/socket.io")` (or an injected value) to `io()`. | 4 |
| F5 | High | `server.js:54-73` | `new Server(server, { ... })` with default `path` | Socket.IO only served at `/socket.io`, never under the base. | Set `path` to `${BASE_PATH}/socket.io` (root when base is empty). | 3 |
| F6 | High | `server.js:314-326` | `express.static(PUBLIC_DIR)` mounted at `/` | Case A works; case B (`/TaoPat/...`) 404s. | Normalize/strip `BASE_PATH` in a middleware before static + routes; mount static at base. | 3 |
| F7 | High | `server.js:299-308` | `app.get("/healthz")` at root only | Case B: `/TaoPat/healthz` 404s; monitoring may probe either shape. | Register health at both normalized base and root (root kept for tunnel/monitoring). | 3 |
| F8 | Med | `server.js:333-351` | `app.get("/api/status")` at root only | Case B: `/TaoPat/api/status` 404s. | Same normalization as F6; expose at base. | 3 |
| F9 | Med | `public/index.html:8,215-220` | Document-relative `css/...`, `js/...` | Works only if the document URL ends with `/TaoPat/`. A request to `/TaoPat` (no slash) resolves assets to the site root. | Redirect `/TaoPat` → `/TaoPat/` (301) and/or emit a `<base href>`; keep relative refs. | 3, 4 |
| F10 | Med | `server.js:63-72` | `allowRequest` checks `Origin` against `ALLOWED_ORIGINS` | Browser `Origin` under sub-path is `https://deni26.games`, not the tunnel host. Misconfiguration silently rejects sockets. | No code change; document that `ALLOWED_ORIGINS` must list the **public** origin(s). | 5 |
| F11 | Med | `public/js/tao-core.js:78-98` | `resolveAssetUrl()` returns leading-`/` paths unchanged | Correct for assets; cannot express base-aware app routes. | Add `appUrl()`/`withBase()` and `setBasePath()`; keep `assetUrl()` semantics. | 2 |
| F12 | Low | `public/css/style.css:10,16,22` | `url("../assets/fonts/...")` relative to CSS | Correct at any base (CSS-relative). | No change; add a regression test. | 5 |
| F13 | Low | `public/js/music.js:10-11,71` | Already uses `TaoCore.assetUrl()` with relative paths | Already portable. | No change; covered by tests. | 5 |
| F14 | Low | `server.js:293` | `Content-Security-Policy: base-uri 'self'` | If a `<base href>` is introduced it must stay same-origin. | Keep as-is; `<base>` will be same-origin. | 3 |
| F15 | Low | `server.js:285-296` | Hardening headers applied globally | No base impact. | None. | — |
| F16 | Low | `scripts/_check_urls.js:3-24` | Smoke script probes root paths only | Won't verify the sub-path deployment. | Optionally prefix probes with `BASE_PATH` (or run twice). | 5 |
| F17 | Low | `tests/asset-paths.test.js:38-41` | Asserts root-relative `/socket.io/socket.io.js` | Contradicts the sub-path requirement. | Rewrite to assert a base-aware/document-relative socket.io client reference. | 5 |
| F18 | Low | `.env.example`, `.env.production.example` | No `BASE_PATH` | Operators cannot configure the sub-path. | Document `BASE_PATH` (empty = root) in both. | 2 |
| F19 | Low | `README.md` | No base-path/proxy deployment section | Operators must guess. | Add a "Deploying under a sub-path / behind a proxy" section. | 5 |

No other issues found:

- No `fetch()` calls in the client (all data flows over Socket.IO).
- No service worker, `manifest.json`, `res.redirect()`, or cookie logic.
- No `process.cwd()` use; filesystem paths already derive from `__dirname`
  (`server.js:78-87`), so running from any working directory is safe.
- No `location`/`href` manipulation that depends on the origin.
- Static cache policy (`server.js:317-324`) is path-agnostic.

---

## 4. Planned design

### 4.1 Server: `lib/basepath.js`

Pure, dependency-free module (same pattern as `lib/guard.js`), unit-testable.

```
normalizeBasePath(value)   -> "" | "/TaoPat"   (trim, leading slash, no trailing slash,
                                                reject "..", "?", "#", control chars)
withBase(basePath, route)  -> "/TaoPat/healthz" (joins, collapses slashes)
stripBase(basePath, path)  -> path without the base prefix, or null if absent
publicBaseFromRequest(req, configuredBase, trustProxy)
                           -> configured base, or a validated X-Forwarded-Prefix
```

Rules:

- `BASE_PATH` comes from `config.js` (the only `process.env` reader) and is
  normalized once at startup.
- `X-Forwarded-Prefix` is **untrusted** and only honored when proxy trust is
  enabled **and** the value normalizes to an allowlisted base. Never reflect the
  raw header into generated URLs. Default: use configured `BASE_PATH`.
- Path normalization happens in one Express middleware placed before static and
  routes: if `req.url` starts with `BASE_PATH + "/"` (or equals it), strip it
  so downstream handlers see root-relative paths (supports case B). If it does
  not (case A), leave it alone.
- Root `/healthz` stays registered for the tunnel/health monitor even when a
  base path is configured.

### 4.2 Client: `TaoCore.appUrl()` / `TaoCore.withBase()`

- `TaoCore.setBasePath(path)` and `TaoCore.basePath()`.
- `TaoCore.appUrl(route)` returns `withBase(basePath, route)`; absolute URLs
  pass through.
- Base path is delivered to the browser from the server (injected
  `<meta name="app-base-path" content="...">` or an inline
  `window.__TAO_BASE_PATH__` set before the JS bundle), so the client never
  guesses from `location.pathname`.
- `TaoCore.assetUrl()` keeps its document-relative behavior unchanged.
- `app.js` uses `path: TaoCore.appUrl("/socket.io")` for `io()`.
- `index.html` loads the Socket.IO client document-relative
  (`socket.io/socket.io.js`), which resolves under the base when the document
  URL ends with `/`.

### 4.3 Redirect

`GET <base>` (no trailing slash) → `301` to `<base>/`, so relative asset and
script URLs resolve under the base. Root (`/`) is unaffected.

---

## 5. Proxy / Worker compatibility

| Concern | Handling |
| --- | --- |
| Prefix stripped (case A) | Works as today; `BASE_PATH` only affects generated URLs (socket path/client script). |
| Prefix kept (case B) | Normalization middleware strips the configured base before routing. |
| `X-Forwarded-Proto` / `Host` | Not required for correctness; generated URLs stay relative or base-relative. |
| `X-Forwarded-Prefix` | Untrusted; validated against configured base before use. |
| `X-Forwarded-For` / `CF-Connecting-IP` | Existing `TRUST_PROXY` handling (`lib/guard.js`) unchanged. |
| WebSocket upgrade | Socket.IO `path` is base-aware; the Worker must forward upgrades (owner-side, out of repo scope). |
| `Origin` | `ALLOWED_ORIGINS` must include the public origin; documented. |

Worker-side requirement (not changed here, reported for the owner): forward
WebSocket upgrades for the chosen path and either strip or keep the prefix
consistently.

---

## 6. Test plan

| Test | Location | Verifies |
| --- | --- | --- |
| `normalizeBasePath` cases | `tests/basepath.test.js` | `""`, `/`, `/TaoPat`, `/TaoPat/`, invalid input, `..` rejection. |
| `withBase` / `stripBase` | `tests/basepath.test.js` | Root and sub-path joins, idempotent stripping. |
| `appUrl` / `setBasePath` | `tests/paths.test.js` | App routes prefixed; assets unchanged; absolute URLs untouched. |
| Asset scan (existing, updated) | `tests/asset-paths.test.js` | No root-relative asset URLs; socket.io client reference is base-aware; fonts still resolve. |
| Server routes at base | `tests/server-basepath.test.js` (or route-level unit) | `/TaoPat`, `/TaoPat/`, `/TaoPat/healthz`, `/TaoPat/api/status` behave; root `/healthz` still works. |
| Socket.IO path | `tests/server-basepath.test.js` | Client script served under the base and handshake succeeds at `<base>/socket.io`. |
| Full suite | `npm test` | No regressions (currently 52 tests). |

---

## 7. Out of scope

- Changing Cloudflare Tunnel/DNS/Worker configuration (owner-side).
- Hardcoding any `deni26.games` host in the app.
- Rewriting CSS asset URLs or introducing a build step.
- New runtime dependencies (none needed; `URL`/`path` suffice).

---

## 8. Execution order

1. **Phase 2** — `lib/basepath.js`, `config.BASE_PATH`, `.env.example` /
   `.env.production.example`, `TaoCore.appUrl`/`setBasePath` + tests.
2. **Phase 3** — `server.js`: normalization middleware, static/API/health
   mounting, Socket.IO `path`, base-aware script injection, `/base` redirect.
3. **Phase 4** — `index.html` socket.io script + base injection, `app.js` `io()`
   path, `fx.js` asset dirs.
4. **Phase 5** — tests, `scripts/_check_urls.js`, README deployment docs,
   final `npm test`.
