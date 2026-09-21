// Preview host for the built customer and Platform Admin artifacts.
//
// `vite preview` serves a single outDir and runs no plugins, so the dev-only
// entryBoundaryRouter does not apply: under `vite preview` every /app-admin/* request
// fell through to the customer document, which made the Story 12.1 Platform Admin
// boundary spec unrunnable in CI. This server mirrors the production host rule the
// artifacts are built for — one origin, path-prefixed routing, each artifact
// receiving only its own fallback document (AC2).
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request as proxyRequest } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '../dist/app')
const adminRoot = resolve(import.meta.dirname, '../dist/admin')
const port = Number(process.env.WEB_PORT ?? 5173)
const apiTarget = new URL(process.env.API_URL ?? 'http://localhost:8080')

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

// Apple and Google read these to decide whether the mobile app may open this origin's links.
// Both are JSON whatever their name says, and a missing one is a 404 rather than the fallback
// document. Mirrors dist/app/deployment.json contentTypes and fallbackExcludes.
const exactTypes = {
  '/.well-known/apple-app-site-association': 'application/json',
  '/.well-known/assetlinks.json': 'application/json',
}

for (const [label, root] of [
  ['dist/app', appRoot],
  ['dist/admin', adminRoot],
]) {
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`Missing ${label}/index.html — run "npm run build" first`)
  }
}

function safeJoin(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const normalized = normalize(decoded.replaceAll('\\', '/')).replace(/^(\.\.(\/|\\|$))+/, '')
  return join(root, normalized)
}

function readableFile(candidate) {
  return Boolean(candidate) && existsSync(candidate) && statSync(candidate).isFile()
}

function proxyApi(request, response) {
  const upstream = proxyRequest(
    {
      protocol: apiTarget.protocol,
      hostname: apiTarget.hostname,
      port: apiTarget.port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: apiTarget.host },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    },
  )
  upstream.on('error', () => {
    response.statusCode = 502
    response.end('API proxy error')
  })
  request.pipe(upstream)
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://app.local').pathname

  if (pathname.startsWith('/api/')) {
    proxyApi(request, response)
    return
  }

  // The Platform Admin artifact owns /app-admin/*; everything else is the customer
  // artifact. Neither ever serves the other's fallback document.
  const isAdmin = pathname === '/app-admin' || pathname.startsWith('/app-admin/')
  const primaryRoot = isAdmin ? adminRoot : appRoot

  // Hashed asset filenames are unique per artifact, so a shared /assets prefix is
  // unambiguous; fall back to the sibling root so an admin chunk still resolves when
  // the browser requests it from the shared origin.
  let candidate = safeJoin(primaryRoot, pathname)
  if (!readableFile(candidate)) {
    const sibling = safeJoin(isAdmin ? appRoot : adminRoot, pathname)
    candidate = readableFile(sibling) ? sibling : null
  }

  if (!candidate) {
    if (pathname.startsWith('/.well-known/')) {
      response.statusCode = 404
      response.end()
      return
    }
    candidate = join(primaryRoot, 'index.html')
  }

  response.statusCode = 200
  response.setHeader(
    'Content-Type',
    exactTypes[pathname] ?? types[extname(candidate)] ?? 'application/octet-stream',
  )
  response.setHeader('X-Content-Type-Options', 'nosniff')
  // Delivered as a header because <meta> CSP cannot carry frame-ancestors; the
  // authenticated shells must not be framable. Mirrors deployment.json
  // responseHeaders for both artifacts.
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  createReadStream(candidate).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Leaveo app + admin artifacts listening on http://127.0.0.1:${port}`)
})
