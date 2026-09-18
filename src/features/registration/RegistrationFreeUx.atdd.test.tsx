import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as publicClient from '../../api/publicClient'
import { RegistrationFlow } from './RegistrationFlow'

vi.mock('../public-site/analyticsGateway', () => ({
  emitApprovedPublicEvent: vi.fn().mockResolvedValue(undefined),
}))

const pending: publicClient.RegistrationState = {
  registrationId: 'reg-123',
  status: 'VERIFICATION_PENDING',
  selectedPlan: 'FREE',
  intendedCount: 3,
  maskedEmail: 'j*****@example.com',
  organizationName: 'Jordan Free',
  locale: 'en',
  country: 'US',
  timezone: 'America/New_York',
  safeReturnPath: '/',
  resendAvailableInSeconds: 60,
  workspaceCreated: false,
  recoveryAction: null,
  checkoutSessionId: null,
}

describe('Registration Free UX — Story 12.3', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/register?plan=FREE&intendedCount=3')
  })

  it('[P0] presents card-free Free intent and masks email with a disabled resend cooldown', async () => {
    vi.spyOn(publicClient, 'startRegistration').mockResolvedValue(pending)
    const user = userEvent.setup()
    render(<RegistrationFlow locale="en" route="/register" />)

    expect(screen.getByTestId('register-plan-summary')).toHaveTextContent(/Free.*5 active users.*no card/i)
    expect(screen.queryByText(/enter card|Stripe|trial ends/i)).not.toBeInTheDocument()
    // The link carries 3, but the field reports what Free includes and is not an input.
    const count = await waitFor(() => screen.getByTestId('register-intended-count'))
    expect(count).toHaveValue(5)
    expect(count).toHaveAttribute('readonly')
    await user.type(screen.getByTestId('register-email'), 'jordan@example.com')
    await user.type(screen.getByTestId('register-org-name'), 'Jordan Free')
    await user.click(screen.getByTestId('register-submit'))

    expect(await screen.findByTestId('verification-masked-email')).toHaveTextContent('j*****@example.com')
    expect(screen.getByTestId('verification-resend')).toBeDisabled()
    expect(publicClient.startRegistration).toHaveBeenCalledWith(expect.objectContaining({
      selectedPlan: 'FREE', intendedCount: 5, safeReturnPath: '/',
    }), expect.any(String))
    expect(publicClient.startRegistration).toHaveBeenCalledWith(
      expect.not.objectContaining({ organizationId: expect.anything(), role: expect.anything(), billingStatus: expect.anything() }),
      expect.any(String),
    )
  })

  it('[P0] removes the verification credential from the URL before a failed consume and exposes only neutral recovery', async () => {
    vi.spyOn(publicClient, 'verifyRegistration').mockRejectedValue(new Error('expired'))
    window.history.replaceState({}, '', '/register/verify?registrationId=reg-123&token=secret-token')

    render(<RegistrationFlow locale="en" route="/register/verify" />)

    expect(window.location.search).toBe('')
    expect(await screen.findByTestId('registration-expired-recovery')).toBeVisible()
    expect(screen.getByTestId('registration-recovery')).toBeVisible()
    expect(screen.queryByTestId('provision-submit')).not.toBeInTheDocument()
    expect(screen.queryByText(/does not exist|never registered/i)).not.toBeInTheDocument()
  })

  it('[P0] sends a neutral recovery request without a workspace claim', async () => {
    vi.spyOn(publicClient, 'recoverRegistration').mockResolvedValue({
      status: 'ACCEPTED', nextAction: 'CHECK_EMAIL',
    })
    const user = userEvent.setup()
    render(<RegistrationFlow locale="en" route="/register/recovery" />)

    await user.type(screen.getByLabelText(/Administrator email/i), 'jordan@example.com')
    await user.click(screen.getByTestId('registration-recovery'))

    expect(await screen.findByRole('status')).toHaveTextContent(/If a registration can continue/i)
    expect(screen.queryByText(/workspace (exists|created|ready)/i)).not.toBeInTheDocument()
  })
})
