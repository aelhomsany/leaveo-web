import path from 'node:path'
import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'

/**
 * Fails a run in which a contracted P0 suite executed nothing.
 *
 * <p>`verify:e2e-tags` can only prove a suite *exists*: it runs under `playwright test --list`,
 * where every test is unstarted by definition. That gap is how the Story 12.4 paid P0 journeys sat
 * behind an environment flag no script ever set — advertised in the tag manifest, counted in the
 * totals, and never once executed. A green regression run said nothing about them.
 *
 * <p>A suite is contracted when it is tagged `@api` and any of its tests is titled `[P0]`. Both
 * halves matter. `[P0]` is what the stories name as blocking; `@api` is the dependency this runner
 * exists to provide, so an `@api` P0 suite skipping here means the thing the command was built for
 * did not happen. `@ui-only` P0 suites are excluded deliberately — they need the generated public
 * artifact, which this runner does not build, and failing them here would be noise.
 *
 * <p>Only tests Playwright actually selected are considered, so narrowing a run with `--grep` is
 * not an error — running the contracted command and skipping everything is.
 *
 * <p>Opt-in via `E2E_REQUIRE_CONTRACTED`, set by `scripts/run-e2e-with-api.sh`. The guard belongs
 * to the maintained regression command, not to every ad-hoc invocation: `test:e2e:public` and
 * `test:e2e:ui-only` legitimately select suites whose dependencies are absent, and failing those
 * would train people to ignore it.
 */

const P0_TITLE = /^\[P0\]/

function relativeFile(test: TestCase): string {
  const normalized = test.location.file.split(path.sep).join('/')
  const marker = '/tests/e2e/'
  const index = normalized.lastIndexOf(marker)
  return index >= 0 ? normalized.slice(index + marker.length) : path.basename(normalized)
}

function describePath(test: TestCase): string {
  const titles: string[] = []
  let suite: Suite | undefined = test.parent
  while (suite) {
    if (suite.type === 'describe' && suite.title) titles.unshift(suite.title)
    suite = suite.parent
  }
  return titles.join(' > ')
}

type SuiteExecution = { contracted: boolean; executed: number; skipped: number }

class ContractedExecutionReporter implements Reporter {
  private readonly enabled = process.env.E2E_REQUIRE_CONTRACTED === 'true'
  private readonly suites = new Map<string, SuiteExecution>()

  onBegin(_config: unknown, suite: Suite): void {
    if (!this.enabled) return
    for (const test of suite.allTests()) {
      const key = `${relativeFile(test)}::${describePath(test)}`
      const entry = this.suites.get(key) ?? { contracted: false, executed: 0, skipped: 0 }
      if (P0_TITLE.test(test.title) && test.tags.includes('@api')) entry.contracted = true
      this.suites.set(key, entry)
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.enabled) return
    const key = `${relativeFile(test)}::${describePath(test)}`
    const entry = this.suites.get(key)
    if (!entry) return
    // `interrupted` is the run being cut short, not the suite declining to run.
    if (result.status === 'skipped') entry.skipped += 1
    else entry.executed += 1
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    if (!this.enabled) return
    const inert = [...this.suites.entries()]
      .filter(([, entry]) => entry.contracted && entry.executed === 0 && entry.skipped > 0)
      .map(([key, entry]) => `  ${key} (${entry.skipped} selected, 0 executed)`)

    if (inert.length === 0) return
    process.stdout.write(
      `\nContracted P0 suites were selected but executed nothing:\n${inert.join('\n')}\n`
      + 'A P0 journey that cannot run is not coverage. Start its dependency, or stop advertising '
      + 'it as coverage.\n',
    )
    return { status: result.status === 'passed' ? 'failed' : result.status }
  }
}

export default ContractedExecutionReporter
