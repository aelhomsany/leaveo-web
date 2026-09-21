import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const dist = join(projectRoot, 'dist')
const errors = []

function check(condition, message) {
  if (!condition) errors.push(message)
}

function walk(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

for (const artifact of ['public', 'app', 'admin']) {
  check(existsSync(join(dist, artifact)), `Missing dist/${artifact}`)
  check(existsSync(join(dist, artifact, 'index.html')), `dist/${artifact} has no index.html entry`)
  check(existsSync(join(dist, artifact, 'deployment.json')), `dist/${artifact} has no deployment contract`)
  const htmlFiles = walk(join(dist, artifact)).filter((path) => path.endsWith('.html'))
  check(htmlFiles.length > 0, `dist/${artifact} has no independent HTML entry`)
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(htmlFile, 'utf8')
    const meta = html.match(
      /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=["']([^"']+)["']/i,
    )
    check(Boolean(meta), `${htmlFile}: missing artifact CSP`)
    if (!meta) continue

    const policy = meta[1]
    // A <meta> CSP cannot carry these — browsers ignore them there and log a console
    // error. Declaring frame-ancestors in the document was creating the impression of
    // clickjacking protection that the artifact did not actually have; it belongs in a
    // response header, which is asserted separately below.
    for (const inert of ['frame-ancestors', 'report-uri', 'sandbox']) {
      check(
        !new RegExp(`(^|;)\\s*${inert}\\b`).test(policy),
        `${htmlFile}: ${inert} is ignored in a <meta> CSP — deliver it as a response header`,
      )
    }
    check(
      !/unsafe-inline|unsafe-eval/.test(policy),
      `${htmlFile}: CSP must not weaken script/style with unsafe-inline or unsafe-eval`,
    )
  }

  // Every artifact must state the clickjacking and sniffing headers its host is
  // required to send, so the contract is reviewable in the repo rather than living
  // only in an unversioned CDN console.
  const contractPath = join(dist, artifact, 'deployment.json')
  if (existsSync(contractPath)) {
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
    const headers = contract.responseHeaders ?? {}
    check(
      headers['X-Frame-Options'] === 'DENY',
      `dist/${artifact}/deployment.json: responseHeaders must set X-Frame-Options: DENY`,
    )
    check(
      typeof headers['Content-Security-Policy'] === 'string' &&
        headers['Content-Security-Policy'].includes("frame-ancestors 'none'"),
      `dist/${artifact}/deployment.json: responseHeaders must set a CSP with frame-ancestors 'none'`,
    )
    check(
      headers['X-Content-Type-Options'] === 'nosniff',
      `dist/${artifact}/deployment.json: responseHeaders must set X-Content-Type-Options: nosniff`,
    )
  }
}

// The mobile app's link association (mobile-app-links.ts) belongs to the customer origin
// alone. Whatever is there must be JSON, the host contract must keep both paths JSON and out
// of the fallback, and neither file may turn up in another artifact — which is exactly what
// dropping them into public/ would do, since Vite copies public/ into all three.
const wellKnownFiles = ['apple-app-site-association', 'assetlinks.json']
for (const name of wellKnownFiles) {
  const builtPath = join(dist, 'app', '.well-known', name)
  if (existsSync(builtPath)) {
    try {
      JSON.parse(readFileSync(builtPath, 'utf8'))
    } catch {
      errors.push(`dist/app/.well-known/${name} is not JSON`)
    }
  }
  for (const other of ['public', 'admin']) {
    check(
      !existsSync(join(dist, other, '.well-known', name)),
      `dist/${other}/.well-known/${name}: the mobile app's links live on the customer origin only`,
    )
  }
}
const appContractPath = join(dist, 'app', 'deployment.json')
if (existsSync(appContractPath)) {
  const contract = JSON.parse(readFileSync(appContractPath, 'utf8'))
  check(
    (contract.fallbackExcludes ?? []).includes('/.well-known/'),
    'dist/app/deployment.json: fallbackExcludes must keep /.well-known/ out of the fallback document',
  )
  for (const name of wellKnownFiles) {
    check(
      contract.contentTypes?.[`/.well-known/${name}`] === 'application/json',
      `dist/app/deployment.json: contentTypes must serve /.well-known/${name} as application/json`,
    )
  }
}

const publicGraph = walk(join(dist, 'public'))
  .filter((path) => path.endsWith('.js'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
check(!/auth\/refresh|auth\/me|AuthProvider|AdminShell|OrgShell/.test(publicGraph), 'Public graph contains authenticated startup code')

const customerGraph = walk(join(dist, 'app'))
  .filter((path) => path.endsWith('.js'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
// Match on symbols that only exist if operator code was actually bundled, not on any
// occurrence of the route prefix: the customer graph legitimately names "/app-admin" as
// a string in its redirect denylist, precisely so customer sign-in cannot consume
// Admin return state. Flagging that would punish the boundary being enforced.
check(
  !/PlatformAuthProvider|usePlatformAuth|platformApiClient|platformTokenStorage|PlatformLoginPage|PlatformAdminShell|PlatformProtectedRoute|\/api\/v1\/platform-auth/.test(
    customerGraph,
  ),
  'Customer graph contains Platform Admin auth code',
)

const adminGraph = walk(join(dist, 'admin'))
  .filter((path) => path.endsWith('.js'))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')
check(!/forgot-password|reset-password|features\/dashboard|features\/my-leaves/.test(adminGraph), 'Admin graph contains customer recovery or workforce code')
// Org nav metadata leaks through shared layout components rather than through feature
// imports, so the module-path greps above cannot see it: UserMenu is mounted by both
// shells, and its ORG_NAV_ITEMS import once shipped the whole org nav catalog into the
// admin artifact while this gate stayed green.
check(!/nav-dashboard|nav-my-leaves|nav-approvals|nav-calendar/.test(adminGraph), 'Admin graph contains org workforce navigation metadata')

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'))
  process.exit(1)
}
console.log('Verified independent public, customer, and Platform Admin artifact graphs.')
