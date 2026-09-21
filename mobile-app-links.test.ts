import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { Plugin, PluginOption, UserConfigFnObject } from 'vite'
import viteConfig from './vite.config'
import {
  APPLE_APP_SITE_ASSOCIATION,
  ASSET_LINKS,
  mobileAppLinks,
  mobileAppLinksPlugin,
  wellKnownFiles,
  wellKnownMiddleware,
  type MobileAppLinks,
} from './mobile-app-links'

const TEAM_ID = 'ABCDE12345'
// 32 pairs, the shape keytool and the Play Console print a SHA-256 in.
const FINGERPRINT = Array.from({ length: 32 }, (_, i) =>
  (i * 7).toString(16).padStart(2, '0').toUpperCase(),
).join(':')

function withIds(teamId: string, fingerprints: readonly string[]): MobileAppLinks {
  return {
    ...mobileAppLinks,
    ios: { ...mobileAppLinks.ios, teamId },
    android: { ...mobileAppLinks.android, sha256CertFingerprints: fingerprints },
  }
}

const unconfigured = withIds('', [])
const configured = withIds(TEAM_ID, [FINGERPRINT])

describe('mobile app links', () => {
  it('claims the two emailed links for net.leaveo.app, as the app does', () => {
    // Leaveo-Mobile's AndroidManifest.xml and Runner.entitlements claim these paths for this
    // app ID. The two sides have to agree, or the platform opens the browser.
    expect(mobileAppLinks.paths).toEqual(['/reset-password', '/accept-invitation'])
    expect(mobileAppLinks.ios.bundleId).toBe('net.leaveo.app')
    expect(mobileAppLinks.android.packageName).toBe('net.leaveo.app')
  })

  it('serves nothing until the identifiers exist', () => {
    expect(wellKnownFiles(unconfigured).size).toBe(0)
  })

  it('writes the Apple association for the team-prefixed app ID, one component per path', () => {
    const body = wellKnownFiles(configured).get(APPLE_APP_SITE_ASSOCIATION)

    expect(JSON.parse(body ?? 'null')).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['ABCDE12345.net.leaveo.app'],
            components: [{ '/': '/reset-password' }, { '/': '/accept-invitation' }],
          },
        ],
      },
    })
  })

  it('writes the Android statement for the package and every signing certificate', () => {
    const second = FINGERPRINT.split(':').reverse().join(':')
    const body = wellKnownFiles(withIds('', [FINGERPRINT, second])).get(ASSET_LINKS)

    expect(JSON.parse(body ?? 'null')).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'net.leaveo.app',
          sha256_cert_fingerprints: [FINGERPRINT, second],
        },
      },
    ])
  })

  it('lets each platform arrive on its own', () => {
    expect([...wellKnownFiles(withIds(TEAM_ID, [])).keys()]).toEqual([APPLE_APP_SITE_ASSOCIATION])
    expect([...wellKnownFiles(withIds('', [FINGERPRINT])).keys()]).toEqual([ASSET_LINKS])
  })

  it.each([
    ['a lower-case Team ID', withIds('abcde12345', []), /Team ID/],
    ['a Team ID one character short', withIds('ABCDE1234', []), /Team ID/],
    ['a SHA-1 where a SHA-256 belongs', withIds('', [FINGERPRINT.slice(0, 59)]), /SHA-256/],
    ['a lower-case fingerprint', withIds('', [FINGERPRINT.toLowerCase()]), /SHA-256/],
    ['a fingerprint without its colons', withIds('', [FINGERPRINT.replaceAll(':', '')]), /SHA-256/],
    [
      'a path carrying its query',
      { ...configured, paths: ['/reset-password?token=abc'] },
      /plain path/,
    ],
    ['a wildcard path', { ...configured, paths: ['/reset-*'] }, /plain path/],
    ['no paths at all', { ...configured, paths: [] }, /nothing to claim/],
    [
      'a package name that is not one',
      { ...configured, android: { ...configured.android, packageName: 'leaveo' } },
      /package name/,
    ],
  ])('refuses %s instead of shipping a file the platform ignores', (_label, links, reason) => {
    expect(() => wellKnownFiles(links)).toThrow(reason)
  })
})

describe('wellKnownMiddleware', () => {
  let server: Server | undefined

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  // A real HTTP round trip: the headers are the point, and a fake response object would only
  // prove the middleware called setHeader.
  async function serve(links: MobileAppLinks): Promise<void> {
    const middleware = wellKnownMiddleware(wellKnownFiles(links))
    server = createServer((req, res) =>
      middleware(req, res, () => {
        // What the dev server would do next: its SPA fallback, answering with the app.
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html')
        res.end('<!doctype html>')
      }),
    )
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
  }

  function send(
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
    const { port } = server?.address() as AddressInfo
    return new Promise((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => (body += chunk))
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
        )
      })
      outgoing.on('error', reject)
      outgoing.end()
    })
  }

  it.each([APPLE_APP_SITE_ASSOCIATION, ASSET_LINKS])(
    'serves %s as JSON, even to a browser asking for HTML',
    async (path) => {
      await serve(configured)

      const response = await send('GET', path, { Accept: 'text/html' })

      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toBe('application/json')
      expect(response.body).toBe(wellKnownFiles(configured).get(path))
    },
  )

  it('matches on the path alone, as both platforms fetch it', async () => {
    await serve(configured)

    const response = await send('GET', `${ASSET_LINKS}?cache=bust`)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/json')
  })

  it('answers HEAD with the headers and no body', async () => {
    await serve(configured)

    const response = await send('HEAD', APPLE_APP_SITE_ASSOCIATION)

    expect(response.status).toBe(200)
    expect(Number(response.headers['content-length'])).toBe(
      Buffer.byteLength(wellKnownFiles(configured).get(APPLE_APP_SITE_ASSOCIATION) ?? ''),
    )
    expect(response.body).toBe('')
  })

  it.each([APPLE_APP_SITE_ASSOCIATION, ASSET_LINKS])(
    'answers %s with a 404 until it is configured, not with the app',
    async (path) => {
      await serve(unconfigured)

      const response = await send('GET', path, { Accept: 'text/html' })

      expect(response.status).toBe(404)
      expect(response.body).toBe('')
    },
  )

  it('turns away anything but a read', async () => {
    await serve(configured)

    const response = await send('POST', ASSET_LINKS)

    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET, HEAD')
  })

  it.each(['/reset-password', '/.well-known/security.txt', '/.well-known/assetlinks.json/x'])(
    'leaves %s to the rest of the server',
    async (path) => {
      await serve(configured)

      const response = await send('GET', path, { Accept: 'text/html' })

      expect(response.body).toBe('<!doctype html>')
    },
  )
})

describe('mobileAppLinksPlugin', () => {
  function emitted(links: MobileAppLinks): Array<{ fileName: string; source: string }> {
    const files: Array<{ fileName: string; source: string }> = []
    const hook = mobileAppLinksPlugin(links).generateBundle as unknown as (this: {
      emitFile: (file: { fileName: string; source: string }) => string
    }) => void
    hook.call({
      emitFile: (file) => {
        files.push({ fileName: file.fileName, source: file.source })
        return file.fileName
      },
    })
    return files
  }

  it('writes both files into the build, under .well-known/', () => {
    const files = wellKnownFiles(configured)

    expect(emitted(configured)).toEqual([
      {
        fileName: '.well-known/apple-app-site-association',
        source: files.get(APPLE_APP_SITE_ASSOCIATION),
      },
      { fileName: '.well-known/assetlinks.json', source: files.get(ASSET_LINKS) },
    ])
  })

  it('writes nothing into the build while unconfigured', () => {
    expect(emitted(unconfigured)).toEqual([])
  })
})

describe('vite.config.ts', () => {
  const saved = process.env.LEAVEO_ARTIFACT

  afterEach(() => {
    if (saved === undefined) delete process.env.LEAVEO_ARTIFACT
    else process.env.LEAVEO_ARTIFACT = saved
  })

  function pluginNames(options: PluginOption[] | undefined): string[] {
    return (options ?? []).flatMap((option) => {
      if (Array.isArray(option)) return pluginNames(option)
      return option && typeof option === 'object' && 'name' in option
        ? [(option as Plugin).name]
        : []
    })
  }

  function pluginsFor(artifact: string): string[] {
    process.env.LEAVEO_ARTIFACT = artifact
    const config = (viteConfig as UserConfigFnObject)({ command: 'serve', mode: 'test' })
    return pluginNames(config.plugins)
  }

  it('serves the links from the customer artifact, ahead of the entry router', () => {
    const names = pluginsFor('customer')

    expect(names).toContain('leaveo-mobile-app-links')
    expect(names.indexOf('leaveo-mobile-app-links')).toBeLessThan(
      names.indexOf('leaveo-entry-boundary-router'),
    )
  })

  it.each(['public', 'admin'])('keeps them out of the %s artifact', (artifact) => {
    expect(pluginsFor(artifact)).not.toContain('leaveo-mobile-app-links')
  })
})
