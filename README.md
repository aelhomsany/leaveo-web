# leaveo-web

React SPA for Leaveo leave management.

## Stack

- React 19, TypeScript, Vite 8
- React Router 7, TanStack Query 5
- Vitest + Testing Library, Playwright E2E

## Local development

### Prerequisites

- Node.js 20.19+ or 22.12+
- Running `leaveo-api` (see sibling repo)

### 1. Configure environment

```bash
cp .env.example .env
```

For **session cookies** (refresh token) in local dev, leave `VITE_API_URL` empty or unset so API calls use relative `/api/*` paths through the Vite proxy on port 5173. Setting `VITE_API_URL=http://localhost:8080` bypasses the proxy and breaks cookie-based refresh.

### 2. Install and run

```bash
npm install
npm run dev
```

SPA runs on **http://localhost:5173**. Requests to `/api/*` are proxied to the API on port 8080.

## Full-stack local dev (with leaveo-api)

1. In sibling repo `../leaveo-api`: ensure local MySQL is running, export `.env`, then `./mvnw spring-boot:run`.
2. In this repo: `cp .env.example .env`, then `npm run dev`.
3. Open **http://localhost:5173** — unauthenticated users land on `/login`.
4. Pilot credentials (password `PilotDev123!` for all):

| Email | Role | Home after login |
|-------|------|------------------|
| `sarah@company.com` | Employee | `/` |
| `alex@company.com` | Manager | `/` |
| `jordan@company.com` | Organization Admin | `/` |
| `riley@leaveo.example` | Platform Admin | `/platform/organizations` |

See `../leaveo-api/README.md` for backend setup.

## Authentication flow

1. **Login** — `/login` posts email/password to `POST /api/v1/auth/login`; access token stored in memory; refresh token in httpOnly cookie (`leaveo_customer_refresh`).
2. **Session restore** — on app load, `AuthProvider` calls `POST /api/v1/auth/refresh` then `GET /api/v1/auth/me`.
3. **Protected routes** — org and admin shells require authentication; unauthenticated visitors redirect to `/login`.
4. **Role guards** — `RoleGuard` enforces authorization after `ProtectedRoute` authentication:
   - Org shell (`shell="org"`): `EMPLOYEE`, `MANAGER`, `ORGANIZATION_ADMIN` only; `PLATFORM_ADMIN` redirects to `/platform/organizations`
   - Admin shell (`shell="admin"`): `PLATFORM_ADMIN` only; org roles redirect to `/`
   - Route-level guards: `/approvals` → Manager + Organization Admin; `/settings` → Organization Admin only
5. **Post-login routing** — org roles → `/` (Dashboard); `PLATFORM_ADMIN` → `/platform/organizations`.
6. **Sign out** — sidebar footer button calls `POST /api/v1/auth/logout`, clears client state, returns to `/login`.
7. **Password reset** — `/forgot-password` and `/reset-password?token=...` (API from Story 1.4).

Unauthorized direct URLs redirect to the user's role home (not a separate 403 page in v1).

Role nav rules live in `src/auth/rolePermissions.ts` (single source of truth for sidebar items and route access helpers).

All HTTP calls go through `src/api/client.ts` with `credentials: 'include'`, Bearer auth, `X-Correlation-Id`, and a single 401 refresh retry.

## Testing

| Purpose | Run from | Command |
|---------|----------|---------|
| All API tests | `leaveo-api` repository root | `./mvnw -q test` |
| All Playwright tests | `leaveo-web` repository root | `npm run test:e2e:api` |
| Exact seven-test Playwright smoke suite | `leaveo-web` repository root | `npm run test:e2e:smoke:api` |
| Full Playwright regression suite | `leaveo-web` repository root | `npm run test:e2e:regression:api` |
| All Vitest unit/component tests | `leaveo-web` repository root | `npm run test:ci` |

The Playwright `:api` commands start the sibling `leaveo-api` service, so port 8080 must be free.
The wrapper inherits exported `DB_*` variables and does not load `leaveo-api/.env`; without exports,
it uses its documented localhost/root defaults. Use a disposable local database with pilot seed data
because API-backed journeys can create or update records.

The unfiltered all-Playwright command and the `@regression` command currently select the same 47
maintained tests. The regression command states the intended selector explicitly.

The canonical Playwright setup, taxonomy, exact smoke membership, and manual-running guidance live
in [`tests/README.md`](tests/README.md). Playwright selectors supplement concrete test identities;
they never replace paths in validation or trace artifacts.

## Other Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Production build to `dist/`. **Requires `VITE_PUBLIC_TURNSTILE_SITE_KEY`** — see [Build prerequisites](#build-prerequisites) |
| `npm run test:e2e:ui-only` | Five browser-only Playwright tests without an API |
| `npm run verify:e2e-tags` | Validate exact E2E manifest and tag invariants |
| `npm run generate:api` | Regenerate OpenAPI types from running API (`http://localhost:8080/v3/api-docs`) |
| `npm run lint` | ESLint |

### Build prerequisites

`npm run build` produces all three artifacts, and the public one fails closed without a
Turnstile site key:

```
- VITE_PUBLIC_TURNSTILE_SITE_KEY is unset: the Turnstile widget would never render and every
  Contact Sales submission would be rejected. Set it before building dist/public.
```

That gate is deliberate, not a defect — a public build that silently ships a dead widget would
break every Contact Sales submission in production. Supply the key:

```bash
VITE_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build
```

`1x00000000000000000000AA` is Cloudflare's documented always-passes **test** key. It is what
`.github/workflows/ci.yml` exports workflow-wide, what `npm run test:e2e:public` passes inline,
and what `.env.example` now carries — so copying `.env.example` to `.env` also makes a bare
`npm run build` work. Real deployments must supply their own key.

### OpenAPI types

Hand-maintained auth types live in `src/api/generated/types.ts`. When the API is running:

```bash
npm run generate:api
```

Commit updated generated files when API contracts change.

### Mobile app links

The mobile app (`net.leaveo.app`) opens `/reset-password` and `/accept-invitation` itself once
this origin agrees to it, through `/.well-known/apple-app-site-association` (iOS) and
`/.well-known/assetlinks.json` (Android). `mobile-app-links.ts` writes both: the dev server
serves them — app-test.leaveo.net is that dev server behind nginx — and `npm run build:app`
puts them in `dist/app/.well-known/`.

Neither is served yet. Each waits on an identifier that does not exist yet:

| File | Fill in | Where it comes from |
|------|---------|---------------------|
| `apple-app-site-association` | `ios.teamId` | Apple Developer → Membership details → Team ID |
| `assetlinks.json` | `android.sha256CertFingerprints` | Play Console → App integrity → App signing: the app-signing certificate **and** the upload certificate |

Until then both paths answer 404 and the links open in the browser, as they always have. Any
other host serving `dist/app` must follow its `deployment.json`: both files as
`application/json` (the Apple one has no extension to say so), and never the fallback document
under `/.well-known/`.

Once deployed, both platforms can be asked what they see:

```bash
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app-test.leaveo.net&relation=delegate_permission/common.handle_all_urls"
curl -s "https://app-site-association.cdn-apple.com/a/v1/app-test.leaveo.net"
```

Apple's CDN caches what it fetched and refreshes on its own schedule, so a change does not
show there straight away.

### Platform organization regression journeys

`tests/e2e/platform-create-organization.spec.ts` and
`tests/e2e/platform-edit-subscription.spec.ts` are API-backed full-stack regression journeys. Run
the full regression wrapper, or target a concrete file while the API is already running:

```bash
E2E_API_AVAILABLE=true npm run test:e2e:regression -- tests/e2e/platform-create-organization.spec.ts
E2E_API_AVAILABLE=true npm run test:e2e:regression -- tests/e2e/platform-edit-subscription.spec.ts
E2E_API_AVAILABLE=true npm run test:e2e:regression -- tests/e2e/team-member-plan-limit.spec.ts
```

They sign in as the seeded Platform Admin. The create journey creates a uniquely named organization
and verifies the row appears with plan badge, initial HR contact, and user count. The edit
subscription journey opens the row action modal, updates the plan, and verifies the plan badge/user
limit update on the Organizations table. The team-member plan-limit journey creates a Free
organization through the platform API, seeds it to the 3-user limit, then verifies Settings shows
the server warning detail and keeps the Add Member modal open.

## Project layout

Feature-first folders under `src/features/`. Shared UI in `src/components/`. Auth session in `src/auth/`. API client in `src/api/client.ts`.

### Application shells

Two route-based shells share one SPA (both require sign-in). Navigation is filtered by role from `/api/v1/auth/me`:

| Role | Org nav | Admin shell |
|------|---------|-------------|
| Employee | Dashboard, My Leaves, Team Calendar | — |
| Manager | + Approvals | — |
| Organization Admin | + Settings | — |
| Platform Admin | — | Organizations only |

| Shell | Routes | Visual |
|-------|--------|--------|
| Organization app | `/`, `/my-leaves`, `/calendar`, `/approvals`, `/settings` | 240px teal sidebar, mist canvas |
| Platform Admin | `/platform`, `/platform/organizations` | Deep teal sidebar, mint CTAs |

Platform Admin sessions are billing-console only: the admin shell has Organizations navigation and
no notification bell, balance cards, leave tables, approvals, calendar, or settings surfaces.

Public routes (no shell): `/login`, `/forgot-password`, `/reset-password`.

Design tokens live in `src/styles/tokens.css` (sourced from planning artifact `DESIGN.md`). Component CSS must use `var(--color-*)` — no hardcoded hex outside `tokens.css`.

### Shared UI primitives (`src/components/ui/`)

Reuse these — never re-implement per feature:

- **`Modal`** — native `<dialog>`; focus trap, Escape, and focus-return come from the browser. All modals go through it (jsdom `showModal` polyfill in `src/test/setup.ts`).
- **`Toast` + `useToast`** — one toast slot per page: 5s auto-dismiss, pauses on hover/focus, dismiss button, `role=status|alert`.
- **`icons.tsx`** — stroke-SVG icon set (currentColor) for all UI chrome; emoji only in content data.
- **`DateField`** (`src/components/DateField.tsx`) — click/Enter/Space open the calendar; native keyboard editing stays enabled.
- Responsive: single **900px breakpoint** — sidebar collapses to a drawer via `ShellTopBar`; pages are `React.lazy` route chunks in `AppRouter.tsx`.

**Manual check:** `npm run dev` → sign in → verify dashboard, browser refresh keeps session, sign out returns to login.
