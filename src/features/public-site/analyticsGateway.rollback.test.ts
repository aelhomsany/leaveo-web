import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSENT_POLICY_VERSION, CONSENT_STORAGE_KEY } from './consent/publicConsent'

/**
 * Story 12.2 AC6 rollback control (SPA-only).
 *
 * `VITE_PUBLIC_ANALYTICS_ENABLED=false` is the client kill switch. It used to be read only
 * where the page view starts, so the two Story 12.2 funnel events — emitted directly from
 * the Pricing and Contact Sales components — bypassed it entirely and kept POSTing after
 * the switch was flipped. The guarantee now lives in the gateway itself.
 *
 * Consent gating is asserted here only as the control condition; the API remains
 * authoritative for event ownership and payload policy (see AnalyticsSalesEventsAtddTest).
 */
describe('analyticsGateway rollback switch — Story 12.2', () => {
  const acceptedConsent = {
    policyVersion: CONSENT_POLICY_VERSION,
    analytics: 'ACCEPTED',
    receiptId: '7b1f0b4e-3a2c-4c1d-9f8a-1b2c3d4e5f60',
    subject: 'a'.repeat(64),
  }

  beforeEach(() => {
    vi.resetModules()
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(acceptedConsent))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    window.localStorage.clear()
  })

  async function emitBothStoryEvents() {
    const gateway = await import('./analyticsGateway')
    await gateway.emitApprovedPublicEvent({
      eventName: 'pricing_plan_selected.v1',
      dimensions: { route: '/pricing', locale: 'en', plan: 'GROWTH', interaction: 'cta' },
    })
    await gateway.emitApprovedPublicEvent({
      eventName: 'contact_sales_started.v1',
      dimensions: { route: '/contact-sales', locale: 'en', formVersion: '1' },
    })
  }

  it('[P2] Given analytics are disabled by the rollback switch, When Pricing and Contact Sales events fire, Then nothing is sent', async () => {
    vi.stubEnv('VITE_PUBLIC_ANALYTICS_ENABLED', 'false')
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitBothStoryEvents()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  // The dedup key is added before the send and released in the catch. Without the release
  // a single offline blip would permanently suppress that event for the session — the
  // gateway would believe it had already been emitted.
  it('[P1] Given a transport failure, When the same event fires again, Then the released dedup key lets it retry and consent survives', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = await import('./analyticsGateway')
    const event = {
      eventName: 'pricing_plan_selected.v1',
      dimensions: { route: '/pricing', locale: 'en', plan: 'GROWTH', interaction: 'cta' },
    } as const

    await gateway.emitApprovedPublicEvent(event)
    await gateway.emitApprovedPublicEvent(event)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // A transport failure is not a refusal: the preference must be left intact.
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).not.toBeNull()
  })

  it('[P1] Given the server refuses the receipt, When an event fires, Then stored consent is cleared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    )
    const gateway = await import('./analyticsGateway')

    await gateway.emitApprovedPublicEvent({
      eventName: 'pricing_plan_selected.v1',
      dimensions: { route: '/pricing', locale: 'en', plan: 'GROWTH', interaction: 'cta' },
    })

    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
  })

  it('[P2] Given the switch is untouched and consent is accepted, When the same events fire, Then both are sent', async () => {
    // Typed with fetch's own (input, init) signature -- not the no-arg shape used by the
    // other fetchMocks in this file -- because this is the one test that reads the call
    // arguments back out (`.mock.calls.map(([, init]) => ...)`) to inspect the POST body.
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitBothStoryEvents()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const names = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).eventName as string,
    )
    expect(names).toEqual(['pricing_plan_selected.v1', 'contact_sales_started.v1'])
  })

  it('[P0] Given analytics consent was never accepted, When the events fire, Then nothing is sent regardless of the switch', async () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ ...acceptedConsent, analytics: 'DECLINED' }),
    )
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitBothStoryEvents()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('[P0] Given a stale consent policy version, When the events fire, Then nothing is sent', async () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ ...acceptedConsent, policyVersion: '2020-01-01' }),
    )
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await emitBothStoryEvents()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
