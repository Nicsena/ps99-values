# 05 · HTTP API Surface — 9 findings (1 high / 5 med / 3 low)

Lens: routes, error semantics, envelopes, pagination, URL fallthrough. Both sides of every contract read.

- **[HIGH] app.ts:27-45 vs api.ts:22-23, 39-40, 61-62, 74-75 — API errors return HTML, not JSON.** Every API GET handler `next(err)`s into the global handler, which unconditionally `res.render('error', …)`. A DB failure on `/api/items` yields `500 text/html`. Only `POST /api/refresh` catches its own errors and returns JSON (`api.ts:82-84`) — 500 semantics differ per surface by accident. No JSON branch keyed off `req.path.startsWith('/api')`.
- **[MED] api.ts:17-20 vs rapService.ts:176-180 — `/api/pets` echoes a `pageSize` the service never used.** Route parses with no upper bound (accepts 9999) and echoes verbatim; `listItems` clamps `≤ 100` else resets to 25. `GET /api/pets?pageSize=500` responds `"pageSize": 500` beside ≤25 rows. (`/api/items` correctly echoes normalized values, rapService.ts:559-560.)
- **[MED] app.ts (no 404 fallthrough) — three different 404 experiences.** Unknown HTML paths (`/foo`) → bare `Cannot GET /foo` text; known-page misses → styled `notFound()` EJS (pages.ts:50-55, used only by `/items/:detailSlug`); unknown `/api/*` → plain text instead of a JSON envelope.
- **[MED] api.ts:30 + rapService.ts:321 — double-decode of `itemKey` can throw `URIError` → HTML 500.** Express already percent-decodes params; the second `decodeURIComponent` throws on literal `%` sequences. `pages.ts:21-25` wraps its decode; this path doesn't.
- **[MED] api.ts:32 vs api.ts:83 vs everything else — three error-envelope shapes.** History 404: `{status:'error', error}`; refresh 500: `{status:'error', error:message}`; other endpoints: bare payloads with no status field and HTML errors.
- **[MED] api.ts:12-41 — legacy `/api/pets` pair fully unserved.** Zero frontend callers (only fetches: items.js:122 → /api/items, search.js:89 → /api/search, header.ejs:90 → /api/refresh). Divergent thinner contract (`ListItemRow` lacks displayName/slug/imageId/exists) and a third, unique history shape (reversed + field-stripped) exists only here.
- **[LOW] api.ts:68-70 vs rapService.ts:583 — duplicated limit validation** for /api/search (route clamp [1,10] + service re-clamp; the service's is unreachable via the route).
- **[LOW] api.ts:14-16 — silent coercion of invalid params** (`sort=foo`→`name`, `page=-3`→1) with no indication; combined with duplicated client whitelists, drift produces silently-wrong results rather than 400s.
- **[LOW] rapService.ts:607 — envelope drift:** `/api/search` returns bare `{items}` vs list endpoints' `{items,total,page,pageSize}`.

## Verified OK

- `/api/items` served fields ⊇ everything items.js reads (`total/page/items[].{name,displayName,pt,shiny,rap,exists,existsPerHour,slug}`); `/api/search` covers all fields search.js reads incl. slug/pt/shiny; `/thumbnails/:name` exists with placeholder-redirect fallback.
- `/api/items` echoes normalized pagination correctly.
