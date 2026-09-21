import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const artifact = process.argv[2]
if (!['app', 'admin'].includes(artifact)) {
  throw new Error('Expected app or admin artifact')
}
const root = resolve(import.meta.dirname, `../dist/${artifact}`)
const source = join(root, `${artifact}.html`)
const destination = join(root, 'index.html')
if (!existsSync(source)) {
  throw new Error(`Missing generated entry ${source}`)
}
renameSync(source, destination)
const configuredApiUrl = process.env.VITE_API_URL?.trim()
if (configuredApiUrl) {
  const apiOrigin = new URL(configuredApiUrl).origin
  const html = readFileSync(destination, 'utf8').replace(
    "connect-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
  )
  writeFileSync(destination, html)
}
writeFileSync(
  join(root, 'deployment.json'),
  JSON.stringify(
    {
      artifact: artifact === 'app' ? 'leaveo-app' : 'leaveo-admin',
      entry: 'index.html',
      fallback: 'index.html',
      ...(artifact === 'app'
        ? {
            // Apple and Google read these to decide whether the mobile app may open this
            // origin's links (mobile-app-links.ts writes them). Both are JSON — the Apple one
            // has no extension to say so — and a missing one is a 404: the fallback document
            // there is a 200 neither platform can read.
            fallbackExcludes: ['/.well-known/'],
            contentTypes: {
              '/.well-known/apple-app-site-association': 'application/json',
              '/.well-known/assetlinks.json': 'application/json',
            },
          }
        : {}),
      noindex: true,
      environmentAllowlist:
        artifact === 'app'
          ? ['VITE_API_URL', 'VITE_APP_*']
          : ['VITE_API_URL', 'VITE_ADMIN_*'],
      apiNamespaces:
        artifact === 'app'
          ? ['/api/v1/auth/**', '/api/v1/** (customer-authorized)']
          : ['/api/v1/platform-auth/**', '/api/v1/platform/**'],
      // Directives a <meta> CSP cannot carry — browsers ignore frame-ancestors there.
      // Without these headers the authenticated shells are framable, so an attacker
      // page could iframe the operator console and overlay its controls. The preview
      // host in scripts/serve-spa-artifacts.mjs sends them too.
      responseHeaders: {
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    },
    null,
    2,
  ),
)
