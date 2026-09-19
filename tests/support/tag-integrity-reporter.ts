import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter'

type ManifestSuite = {
  tags: string[]
  tests: string[]
}

type TagManifest = {
  version: number
  suites: Record<string, ManifestSuite>
  permanentlySkippedTests?: string[]
}

const manifestPath = fileURLToPath(new URL('../e2e/tag-manifest.json', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TagManifest
if (manifest.version !== 1) {
  throw new Error(`Unsupported E2E tag manifest version ${String(manifest.version)}; expected version 1`)
}

const knownTags = new Set(['@smoke', '@regression', '@api', '@ui-only', '@a11y', '@keyboard'])
const storyTagPattern = /^@story-\d+-\d+$/
const reservedTagTokenPattern = /@(smoke|regression|api|ui-only|a11y|keyboard|story-[^\s:]*)/
const expectedTagCounts = new Map([
  ['@smoke', 7],
  ['@regression', 105],
  ['@api', 83],
  ['@ui-only', 22],
])
const approvedSmokeIdentities = new Set([
  'approval-inbox.spec.ts::Approval inbox — Story 3.6::[P2] Manager sees direct-report pending row on Approvals page',
  'auth-login.spec.ts::Authentication API::Given pilot credentials, When logging in via API, Then an access token is returned',
  'auth-login.spec.ts::Authentication UI::Given the login page, When signing in with valid credentials, Then the team calendar loads',
  'public-entry-boundaries.spec.ts::Platform Admin boundary — Story 12.1::[P0] Given customer and Platform Admin credentials, When each is used in both realms, Then only its own realm accepts it',
  'settings-hr.spec.ts::HR Settings page::[P1] Organization Admin sees workforce group tabs and holidays on Settings',
  'settings-hr.spec.ts::HR Settings page::[P1] Switching workforce group tab updates the active weekend label',
  'settings-hr.spec.ts::HR Settings page::[P2] Leave Types card shows Annual Leave row',
])

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function sameMembers(left: string[], right: string[]): boolean {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

function relativeFile(test: TestCase): string {
  const normalized = test.location.file.split(path.sep).join('/')
  const marker = '/tests/e2e/'
  const markerIndex = normalized.lastIndexOf(marker)
  return markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : path.basename(normalized)
}

function describePath(test: TestCase): string {
  const titles: string[] = []
  let suite: Suite | undefined = test.parent

  while (suite) {
    if (suite.type === 'describe' && suite.title) {
      titles.unshift(suite.title)
    }
    suite = suite.parent
  }

  return titles.join(' > ')
}

function displayIdentity(file: string, describe: string, title: string): string {
  return `${file}::${describe}::${title}`
}

function projectName(test: TestCase): string {
  return test.parent.project()?.name ?? '<unknown-project>'
}

const sourceCache = new Map<string, string[]>()

/**
 * Reads the `test.skip(...)` / `test.fixme(...)` call at `location` and decides whether it can
 * ever run. Unconditional forms are `test.skip('title', fn)` and `test.skip(true, ...)`; anything
 * else is treated as a runtime condition and left alone.
 */
function isUnconditionalSkipCall(location: { file: string; line: number; column: number }): boolean {
  let lines = sourceCache.get(location.file)
  if (!lines) {
    try {
      lines = fs.readFileSync(location.file, 'utf8').split('\n')
    } catch {
      return false
    }
    sourceCache.set(location.file, lines)
  }
  // The call may wrap, so look at a small window starting at the reported line.
  const window = lines.slice(location.line - 1, location.line + 2).join(' ')
  const call = window.slice(window.search(/test\.(skip|fixme)\s*\(/))
  const firstArgument = call.replace(/^test\.(skip|fixme)\s*\(\s*/, '')
  return /^(true\b|['"`])/.test(firstArgument)
}

class TagIntegrityReporter implements Reporter {
  private diagnostics: string[] = []

  onBegin(_config: unknown, suite: Suite): void {
    const discovered = new Map<string, Set<string>>()
    const discoveredProjects = new Map<string, Set<string>>()
    const logicalTags = new Map<string, string[]>()
    const skippedIdentities = new Set<string>()

    for (const test of suite.allTests()) {
      const file = relativeFile(test)
      const describe = describePath(test)
      const suiteKey = `${file}::${describe}`
      const identity = displayIdentity(file, describe, test.title)
      const rawTags = test.tags
      const uniqueTags = [...new Set(rawTags)]
      const expectedSuite = manifest.suites[suiteKey]
      const project = projectName(test)

      // An unconditionally skipped test is declared coverage that can never execute. Counting it
      // toward the tag totals let a P0 journey sit permanently at `test.skip(title, fn)` while
      // `verify:e2e-tags` still reported a full complement of @regression tests.
      //
      // Environment-gated suites — `test.skip(process.env.X !== 'true', 'reason')` — are the
      // established convention here and are NOT flagged: they run whenever the dependency is up.
      //
      // The two cannot be told apart from the annotation object: `test.skip(true, 'reason')` and
      // `test.skip(cond, 'reason')` produce byte-identical annotations, and `expectedStatus` is
      // meaningless under `playwright test --list`. So the call site itself is inspected.
      for (const annotation of test.annotations) {
        if ((annotation.type !== 'skip' && annotation.type !== 'fixme') || !annotation.location) continue
        if (isUnconditionalSkipCall(annotation.location)) {
          skippedIdentities.add(identity)
        }
      }

      if (reservedTagTokenPattern.test(`${file} ${describe} ${test.title}`)) {
        this.diagnostics.push(`${identity}: a title or path contains a reserved tag token that can affect --grep selection`)
      }

      if (rawTags.length !== uniqueTags.length) {
        this.diagnostics.push(`${identity}: duplicate tags (${rawTags.join(', ')})`)
      }
      if (!uniqueTags.includes('@regression')) {
        this.diagnostics.push(`${identity}: missing @regression`)
      }

      const dependencyTags = uniqueTags.filter((tag) => tag === '@api' || tag === '@ui-only')
      if (dependencyTags.length !== 1) {
        this.diagnostics.push(`${identity}: expected exactly one dependency tag, found ${dependencyTags.join(', ') || 'none'}`)
      }
      if (uniqueTags.includes('@smoke') && (!uniqueTags.includes('@regression') || !uniqueTags.includes('@api'))) {
        this.diagnostics.push(`${identity}: @smoke requires @regression and @api`)
      }

      for (const tag of uniqueTags) {
        if (!knownTags.has(tag) && !storyTagPattern.test(tag)) {
          this.diagnostics.push(`${identity}: unknown or malformed tag ${tag}`)
        }
      }

      if (!expectedSuite) {
        this.diagnostics.push(`${identity}: unexpected test; suite is absent from tag-manifest.json`)
      } else {
        if (!expectedSuite.tests.includes(test.title)) {
          this.diagnostics.push(`${identity}: unexpected test title for manifest suite`)
        }
        if (!sameMembers(uniqueTags, expectedSuite.tags)) {
          this.diagnostics.push(
            `${identity}: tags differ; expected [${expectedSuite.tags.join(', ')}], found [${uniqueTags.join(', ')}]`,
          )
        }
      }

      const projects = discoveredProjects.get(identity) ?? new Set<string>()
      if (projects.has(project)) {
        this.diagnostics.push(`${identity}: duplicate discovered identity in project ${project}`)
      }
      projects.add(project)
      discoveredProjects.set(identity, projects)

      const firstProjectTags = logicalTags.get(identity)
      if (firstProjectTags && !sameMembers(firstProjectTags, uniqueTags)) {
        this.diagnostics.push(`${identity}: effective tags differ across Playwright projects`)
      } else if (!firstProjectTags) {
        logicalTags.set(identity, uniqueTags)
      }

      const discoveredTitles = discovered.get(suiteKey) ?? new Set<string>()
      discoveredTitles.add(test.title)
      discovered.set(suiteKey, discoveredTitles)
    }

    for (const [suiteKey, expectedSuite] of Object.entries(manifest.suites)) {
      const discoveredTitles = discovered.get(suiteKey)
      if (!discoveredTitles) {
        this.diagnostics.push(`${suiteKey}: manifest suite was not discovered`)
        continue
      }
      for (const title of expectedSuite.tests) {
        if (!discoveredTitles.has(title)) {
          this.diagnostics.push(`${suiteKey}::${title}: manifest test was not discovered`)
        }
      }
      if (discoveredTitles.size !== expectedSuite.tests.length) {
        this.diagnostics.push(
          `${suiteKey}: manifest/discovery count differs (${expectedSuite.tests.length} expected, ${discoveredTitles.size} found)`,
        )
      }
    }

    for (const [tag, expectedCount] of expectedTagCounts) {
      const actualCount = [...logicalTags.values()].filter((tags) => tags.includes(tag)).length
      if (actualCount !== expectedCount) {
        this.diagnostics.push(`${tag}: expected ${expectedCount} logical tests, found ${actualCount}`)
      }
    }

    // Permanent skips must be declared, not discovered. Declaring one does not make it coverage —
    // it makes the exclusion reviewable, and the count is printed so nobody reads the tag totals
    // as "tests that run".
    const declaredPermanentSkips = new Set<string>(manifest.permanentlySkippedTests ?? [])
    for (const identity of skippedIdentities) {
      if (!declaredPermanentSkips.has(identity)) {
        this.diagnostics.push(
          `${identity}: unconditionally skipped, so it is counted as coverage but can never run — gate it on an environment condition with a reason, delete it, or declare it in manifest.permanentlySkippedTests`,
        )
      }
    }
    for (const identity of declaredPermanentSkips) {
      if (!skippedIdentities.has(identity)) {
        this.diagnostics.push(
          `${identity}: declared in manifest.permanentlySkippedTests but is no longer unconditionally skipped — remove the declaration`,
        )
      }
    }
    if (skippedIdentities.size > 0) {
      process.stdout.write(
        `E2E coverage note: ${skippedIdentities.size} declared test(s) never execute and are excluded from real coverage.\n`,
      )
    }

    const discoveredSmokeIdentities = [...logicalTags.entries()]
      .filter(([, tags]) => tags.includes('@smoke'))
      .map(([identity]) => identity)
    if (!sameMembers(discoveredSmokeIdentities, [...approvedSmokeIdentities])) {
      const missing = [...approvedSmokeIdentities].filter((identity) => !discoveredSmokeIdentities.includes(identity))
      const unexpected = discoveredSmokeIdentities.filter((identity) => !approvedSmokeIdentities.has(identity))
      if (missing.length > 0) {
        this.diagnostics.push(`@smoke: approved identities missing: ${missing.join(', ')}`)
      }
      if (unexpected.length > 0) {
        this.diagnostics.push(`@smoke: unapproved identities found: ${unexpected.join(', ')}`)
      }
    }
  }

  async onEnd(): Promise<{ status?: FullResult['status'] } | void> {
    if (this.diagnostics.length === 0) {
      process.stdout.write(`E2E tag integrity passed (${Object.keys(manifest.suites).length} suites).\n`)
      return
    }

    process.stderr.write(`E2E tag integrity failed:\n- ${this.diagnostics.join('\n- ')}\n`)
    return { status: 'failed' }
  }
}

export default TagIntegrityReporter
