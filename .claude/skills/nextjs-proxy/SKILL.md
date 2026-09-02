---
name: nextjs-proxy
description: >
  Use this skill for ANY Next.js App Router work that involves request
  interception, auth checks, redirects, rewrites, CORS headers, or deciding
  between proxy.ts and Route Handlers. Triggers: "Next.js auth", "protect a
  route", "redirect if not logged in", "middleware", "API route", "proxy",
  "Route Handler", "when to use middleware", or any Next.js project work.
---

# Next.js proxy.ts vs Route Handlers — Decision Guide

> Source: Next.js official docs (verified June 2026, v16.2.7)
> https://nextjs.org/docs/app/api-reference/file-conventions/proxy

---

## Critical Rule: middleware.ts is DEPRECATED

`middleware.ts` is **deprecated** in Next.js 16+. It has been renamed to `proxy.ts`.
ALWAYS use `proxy.ts`. NEVER create or suggest `middleware.ts` in new code.

Migration command (for existing projects):
```bash
npx @next/codemod@canary middleware-to-proxy .
```

---

## Quick Decision Table

| Situation | Use |
|---|---|
| Redirect unauthenticated users | `proxy.ts` |
| Check session cookie before page render | `proxy.ts` |
| Add CORS / CSP / security headers globally | `proxy.ts` |
| Rewrite URLs (e.g. /api/v1 → /api/v2) | `proxy.ts` |
| A/B testing routing | `proxy.ts` |
| Locale detection & redirect (i18n) | `proxy.ts` |
| Rate limiting by IP (lightweight) | `proxy.ts` |
| DB query (any) | Route Handler |
| External API call | Route Handler |
| Business logic / data processing | Route Handler |
| File upload / download | Route Handler |
| Webhook handler | Route Handler |
| Auth token verification with DB lookup | Route Handler (NEVER proxy.ts) |
| Heavy computation | Route Handler |

---

## proxy.ts

### Location
```
/proxy.ts         ← project root (same level as /app)
/src/proxy.ts     ← if using /src layout
```

### Canonical template
```typescript
// proxy.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  // Auth guard example — check cookie only, NO DB calls here
  const session = request.cookies.get('session')?.value

  if (!session && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // ALWAYS define matcher — without it, proxy runs on every request
  // including static assets (_next/static, images, favicon)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)',
  ],
}
```

### What proxy.ts CAN do
- `NextResponse.redirect(url)` — send to different URL
- `NextResponse.rewrite(url)` — serve different content, same URL
- `NextResponse.next()` — continue to route
- Read / write **cookies** (`request.cookies.get`, `response.cookies.set`)
- Read / modify **request headers**
- Set **response headers**
- Return `Response.json(...)` directly (simple responses only)

### What proxy.ts CANNOT / MUST NOT do
- ❌ DB queries (no Drizzle, no Prisma, no raw SQL)
- ❌ External API calls (no fetch to third-party services)
- ❌ Import shared modules or globals
- ❌ Heavy computation
- ❌ Session validation that requires a DB lookup → use Route Handler
- ❌ `runtime` config option (throws error)

### Execution order (important)
1. `next.config.js` headers
2. `next.config.js` redirects
3. **proxy.ts** ← here
4. Filesystem routes (public/, _next/static/, pages/, app/)
5. Dynamic routes

---

## Route Handlers

### Location
```
app/api/[path]/route.ts
```

### Canonical template
```typescript
// app/api/courses/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  const courses = await db.query.courses.findMany()
  return NextResponse.json(courses)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const course = await db.insert(courses).values(body).returning()
  return NextResponse.json(course[0], { status: 201 })
}
```

### Route Handler capabilities
- Full Node.js runtime
- DB access (Drizzle, Prisma, raw SQL)
- External API calls
- File system access
- All HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- Streaming responses
- Webhooks with request body parsing

---

## Auth Pattern (proxy.ts + Route Handler together)

```typescript
// proxy.ts — ONLY checks if cookie exists, does NOT validate it
export function proxy(request: NextRequest) {
  const token = request.cookies.get('session')?.value
  if (!token && isProtectedRoute(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

// app/api/auth/me/route.ts — ACTUALLY validates the token with DB
export async function GET(request: NextRequest) {
  const token = request.cookies.get('session')?.value
  const user = await db.query.sessions.findFirst({
    where: eq(sessions.token, token)
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(user)
}
```

**Rule:** proxy.ts = fast cookie presence check only. Route Handler = full token/session validation with DB.

---

## Project-specific constraints

- This project uses **Next.js App Router** (not Pages Router)
- ORM: **Drizzle** with **Neon** serverless PostgreSQL
- Auth: **NextAuth.js v5** — session cookie is managed by NextAuth
- File storage: **Uploadthing**
- Deployment: **Vercel** (serverless, no persistent server)
- NEVER use `middleware.ts` — always `proxy.ts`
- NEVER use `middleware.ts` pattern for auth — use NextAuth's built-in session + Route Handler guards
