import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/**
 * This origin's half of the mobile app's claim on its links.
 *
 * Leaveo-Mobile claims `/reset-password` and `/accept-invitation` on app.leaveo.net and
 * app-test.leaveo.net (android/app/src/main/AndroidManifest.xml, ios/Runner/Runner.entitlements).
 * Neither platform honours that claim until the origin agrees to it, by serving
 * /.well-known/assetlinks.json (Android) and /.well-known/apple-app-site-association (iOS).
 * Until then the emailed links open in the browser — which is what they did before the app.
 *
 * Nothing here is secret: both files are served to anyone who asks for them.
 */
export interface MobileAppLinks {
  /** Paths the app opens itself. Only the path is matched; the token rides in the query. */
  paths: readonly string[]
  ios: {
    bundleId: string
    /** The Apple Developer Team ID, 10 characters. Empty means no apple-app-site-association. */
    teamId: string
  }
  android: {
    packageName: string
    /**
     * SHA-256 of every certificate that signs a build people install — Play's app-signing key
     * and the upload key — written the way keytool and the Play Console print them. Empty means
     * no assetlinks.json.
     */
    sha256CertFingerprints: readonly string[]
  }
}

// Both identifiers are still to come: the Team ID with the Apple Developer account, the
// fingerprints with the app's signing keys. Until they arrive neither file is served.
export const mobileAppLinks: MobileAppLinks = {
  paths: ['/reset-password', '/accept-invitation'],
  ios: { bundleId: 'net.leaveo.app', teamId: '' },
  android: { packageName: 'net.leaveo.app', sha256CertFingerprints: [] },
}

export const APPLE_APP_SITE_ASSOCIATION = '/.well-known/apple-app-site-association'
export const ASSET_LINKS = '/.well-known/assetlinks.json'

const TEAM_ID = /^[A-Z0-9]{10}$/
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
const SHA256_FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/
const PATH = /^\/[^\s?#*]*$/

function refuse(reason: string): never {
  throw new Error(`mobile-app-links.ts: ${reason}`)
}

/**
 * The files this origin serves, keyed by path, as JSON text.
 *
 * A platform with nothing configured gets no file: a 404 plainly says "no association", where
 * a file naming no app reads like one that is broken. A malformed value throws, so a typo
 * stops the build and the dev server instead of shipping a file both platforms quietly ignore.
 */
export function wellKnownFiles(links: MobileAppLinks = mobileAppLinks): Map<string, string> {
  const files = new Map<string, string>()
  const { paths, ios, android } = links
  const configured = ios.teamId !== '' || android.sha256CertFingerprints.length > 0
  if (configured && paths.length === 0) refuse('paths is empty, so there is nothing to claim')
  for (const path of paths) {
    if (!PATH.test(path)) refuse(`"${path}" is not a plain path — no query, fragment or wildcard`)
  }

  if (ios.teamId !== '') {
    if (!TEAM_ID.test(ios.teamId)) refuse(`"${ios.teamId}" is not a 10-character Apple Team ID`)
    if (!BUNDLE_ID.test(ios.bundleId)) refuse(`"${ios.bundleId}" is not a bundle ID`)
    files.set(
      APPLE_APP_SITE_ASSOCIATION,
      json({
        applinks: {
          details: [
            {
              appIDs: [`${ios.teamId}.${ios.bundleId}`],
              components: paths.map((path) => ({ '/': path })),
            },
          ],
        },
      }),
    )
  }

  if (android.sha256CertFingerprints.length > 0) {
    if (!PACKAGE_NAME.test(android.packageName)) {
      refuse(`"${android.packageName}" is not an Android package name`)
    }
    for (const fingerprint of android.sha256CertFingerprints) {
      if (!SHA256_FINGERPRINT.test(fingerprint)) {
        refuse(`"${fingerprint}" is not a SHA-256 fingerprint — 32 upper-case hex pairs joined by ':'`)
      }
    }
    files.set(
      ASSET_LINKS,
      json([
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: android.packageName,
            sha256_cert_fingerprints: android.sha256CertFingerprints,
          },
        },
      ]),
    )
  }

  return files
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Answers both well-known paths before anything else can: a configured file as JSON, an
 * unconfigured one as a 404. Every other request passes through.
 *
 * It has to come first. The dev server's SPA fallback answers any unknown path with the app's
 * HTML and a 200, and entryBoundaryRouter rewrites extensionless document requests to
 * /app.html — so without this, app-test.leaveo.net served its sign-in page at both paths.
 */
export function wellKnownMiddleware(files: ReadonlyMap<string, string>) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname !== APPLE_APP_SITE_ASSOCIATION && pathname !== ASSET_LINKS) {
      next()
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405
      response.setHeader('Allow', 'GET, HEAD')
      response.end()
      return
    }
    const body = files.get(pathname)
    if (body === undefined) {
      response.statusCode = 404
      response.end()
      return
    }
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Content-Length', Buffer.byteLength(body))
    response.end(request.method === 'HEAD' ? undefined : body)
  }
}

/**
 * Serves the files from the dev server — app-test.leaveo.net is that dev server behind nginx —
 * and writes them into the build. Customer artifact only: the links live on the customer
 * origin, and a file in public/ would have been copied into all three artifacts.
 */
export function mobileAppLinksPlugin(links: MobileAppLinks = mobileAppLinks): Plugin {
  const files = wellKnownFiles(links)
  return {
    name: 'leaveo-mobile-app-links',
    configureServer(server) {
      server.middlewares.use(wellKnownMiddleware(files))
    },
    generateBundle() {
      for (const [path, body] of files) {
        this.emitFile({ type: 'asset', fileName: path.slice(1), source: body })
      }
    },
  }
}
