# Deploying PrepTrace (Render + Vercel + MongoDB Atlas)

```
Browser ──► Vercel (apps/web, Next.js) ──/api/* rewrite──► Render (apps/api, Express) ──► MongoDB Atlas (M0)
```

The browser only ever talks to the Vercel origin. `apps/web/next.config.ts` rewrites `/api/*` to
the API, so the session cookie is **first-party** — no CORS preflights, no third-party-cookie blocking.

All three services have free tiers. Allow ~20 minutes end to end.

---

## 1. MongoDB Atlas (database)

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a database user (username + generated password).
3. **Network Access** → add `0.0.0.0/0`. Render's free instances have no fixed egress IP. Access is still protected by the user and password.
4. **Connect → Drivers** → copy the URI and add a database name:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/preptrace?retryWrites=true&w=majority`

The API creates collections and indexes (including TTL indexes for sessions and research cache) on first use.

## 2. Render (API)

**Option A: Blueprint (recommended).** New → **Blueprint** → select the repo. `render.yaml` configures everything; you only fill in the `sync: false` secrets.

**Option B: manual Web Service.** Use these settings:

| Setting | Value |
|---|---|
| Root directory | *(blank: repo root, needed for npm workspaces)* |
| Runtime | Node 20+ |
| Build command | `npm ci --include=dev && npm run build -w @preptrace/api` |
| Start command | `npm run start -w @preptrace/api` |
| Health check path | `/health` |

> ⚠️ Keep `--include=dev`. With `NODE_ENV=production`, npm skips devDependencies, and the build tools (`tsup`, `typescript`) are devDependencies. Without the flag the build fails.

**Environment variables (API):**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas URI from step 1 |
| `SESSION_SECRET` | `openssl rand -base64 48` (≥ 32 chars; the blueprint generates it) |
| `FRONTEND_URL` | `https://<your-app>.vercel.app` (comma-separate extra origins, e.g. a custom domain) |
| `BACKEND_URL` | `https://<your-service>.onrender.com` |
| `TRUST_PROXY` | `2`: browser → Vercel → Render's load balancer. Lets rate limits see real client IPs instead of Vercel's |
| `COOKIE_SAMESITE` | `lax` (default; correct because the cookie is first-party via the rewrite) |
| `LLM_PROVIDER` | `gemini` |
| `LLM_API_KEY` | your Google AI Studio key |
| `LLM_MODEL` | optional: default `gemini-3.5-flash-lite`; `gemini-3.8-flash` for higher quality |
| `SEARCH_PROVIDER` / `TAVILY_API_KEY` | `auto` + optional Tavily key (keyless DuckDuckGo fallback otherwise) |
| `LLM_MAX_RPM` | `10` (match your free-tier limit) |

`PORT` is set by Render automatically, and the API reads it.

**Check:** `curl https://<your-service>.onrender.com/health` should return `{"status":"ok"}`.
`/api/health` also reports `db` and `llm` status.

## 3. Vercel (web)

1. **Add New → Project** → import the repo.
2. **Root Directory:** `apps/web`. Framework preset: **Next.js**. Keep "Include files outside the root directory" enabled: the app imports the `packages/shared` workspace.
3. **Environment variable:** `BACKEND_URL = https://<your-service>.onrender.com` (no trailing slash).
4. Deploy.

> `BACKEND_URL` is read when `next.config.ts` builds the rewrites, so **redeploy after changing it**.
> If Vercel doesn't pick up the workspace install automatically, set **Install Command** to `cd ../.. && npm ci`.

Then set `FRONTEND_URL` on Render to the final Vercel URL and redeploy the API, since the origin check and CORS use it.

## 4. Smoke test

1. Open the Vercel URL → **Get started** → register. DevTools → Application → Cookies should show `pt_session` (HttpOnly, Secure) on the **Vercel** domain.
2. Create a kit with a public company URL (e.g. `https://stripe.com`) and watch the generation timeline.
3. Settings → **System** should show API / Database / AI provider as operational.

## Production notes

- **Cookies:** `HttpOnly`, `Secure` (because `NODE_ENV=production`), `SameSite=Lax`, first-party through the rewrite.
- **SSRF:** production uses the strict policy. Never set `ALLOW_PRIVATE_URLS=true` in production; it exists only for local development against localhost fixture sites.
- **Cold starts:** Render free instances sleep after ~15 minutes idle, and the first request can take ~30–60 s. A generation running when the instance sleeps is marked *interrupted* and offers **Retry**. For demos, open the app a minute early or use a paid instance.
- **Timeouts:** every API request is short (generation runs as a background job and the UI polls), so the Vercel rewrite's proxy timeout isn't a concern. The slowest synchronous call is an answer critique (a few seconds).
- **Secrets:** never commit `.env`; configure secrets in the Render and Vercel dashboards only.
- **Batch evaluator:** doesn't need any of this. `npm run evaluate -- --input cases.json --output kits.json` runs locally with just `LLM_API_KEY`.
