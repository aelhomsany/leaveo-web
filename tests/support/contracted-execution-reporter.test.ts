import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter'

import ContractedExecutionReporter from './contracted-execution-reporter'

/**
 * The guard's whole job is to fail a run nobody is watching, so it needs coverage that does not
 * itself depend on someone watching a run. These drive the reporter directly with the shapes
 * Playwright hands it.
 */

type FakeTest = { title: string; tags: string[]; file: string; describe: string }

function testCase({ title, tags, file, describe: describeTitle }: FakeTest): TestCase {
  const parent = { type: 'describe', title: describeTitle, parent: undefined }
  return {
    title,
    tags,
    location: { file: `/repo/tests/e2e/${file}`, line: 1, column: 1 },
    parent,
  } as unknown as TestCase
}

function run(tests: FakeTest[], statuses: TestResult['status'][]) {
  const reporter = new ContractedExecutionReporter()
  const cases = tests.map(testCase)
  reporter.onBegin({}, { allTests: () => cases } as unknown as Suite)
  cases.forEach((testCaseInstance, index) => {
    reporter.onTestEnd(testCaseInstance, { status: statuses[index] } as TestResult)
  })
  return reporter.onEnd({ status: 'passed' } as FullResult)
}

const apiP0: FakeTest = {
  title: '[P0] Given a paid registration, When the webhook lands, Then one workspace exists',
  tags: ['@regression', '@api', '@story-12-4'],
  file: 'paid-registration.spec.ts',
  describe: 'Paid registration — Story 12.4',
}

describe('contracted execution reporter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('fails a run where a selected @api P0 suite executed nothing', async () => {
    vi.stubEnv('E2E_REQUIRE_CONTRACTED', 'true')
    await expect(run([apiP0], ['skipped'])).resolves.toEqual({ status: 'failed' })
  })

  it('passes when the contracted suite actually ran', async () => {
    vi.stubEnv('E2E_REQUIRE_CONTRACTED', 'true')
    await expect(run([apiP0], ['passed'])).resolves.toBeUndefined()
  })

  it('passes when one test in the suite ran and another was skipped', async () => {
    vi.stubEnv('E2E_REQUIRE_CONTRACTED', 'true')
    const second = { ...apiP0, title: '[P0] Given recovery, When it runs, Then no second charge' }
    await expect(run([apiP0, second], ['passed', 'skipped'])).resolves.toBeUndefined()
  })

  it('ignores a skipped @ui-only P0 suite, which needs an artifact this runner does not build', async () => {
    vi.stubEnv('E2E_REQUIRE_CONTRACTED', 'true')
    const uiOnly = { ...apiP0, tags: ['@regression', '@ui-only', '@story-12-4'] }
    await expect(run([uiOnly], ['skipped'])).resolves.toBeUndefined()
  })

  it('ignores a skipped @api suite with no P0 test', async () => {
    vi.stubEnv('E2E_REQUIRE_CONTRACTED', 'true')
    const p1 = { ...apiP0, title: '[P1] Given a layout, When it reflows, Then nothing overflows' }
    await expect(run([p1], ['skipped'])).resolves.toBeUndefined()
  })

  it('stays inert unless the runner opts in, so ad-hoc commands are unaffected', async () => {
    vi.stubEnv('E2E_REQUIRE_CONTRACTED', '')
    await expect(run([apiP0], ['skipped'])).resolves.toBeUndefined()
  })
})
