import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ResetPasswordPage } from './ResetPasswordPage'

vi.mock('../../api/client', () => ({
  postResetPassword: vi.fn(),
  // Mirrors the real ApiError's actual (status, problem) constructor (src/api/client.ts) -- this
  // local double used to take a redundant (status, message, problem) shape that only happened to
  // type-check because `vi.mock` factories are invisible to tsc, which was still checking call
  // sites against the real 2-arg class.
  ApiError: class ApiError extends Error {
    status: number
    problem?: { type?: string }
    constructor(status: number, problem?: { type?: string }) {
      super('mock api error')
      this.status = status
      this.problem = problem
    }
  },
}))

function renderResetPage(token: string | null = 'valid-token') {
  const path = token ? `/reset-password?token=${token}` : '/reset-password'
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ResetPasswordPage', () => {
  it('renders reset form test ids when token is present', () => {
    renderResetPage()

    expect(screen.getByTestId('reset-password-page')).toBeInTheDocument()
    expect(screen.getByTestId('reset-password')).toBeInTheDocument()
    expect(screen.getByTestId('reset-password-confirm')).toBeInTheDocument()
    expect(screen.getByTestId('reset-password-submit')).toBeInTheDocument()
    expect(screen.getByTestId('password-requirements')).toBeInTheDocument()
  })

  it('Given mismatched passwords that meet strength rules, When submitting, Then shows validation error', async () => {
    const user = userEvent.setup()
    renderResetPage()

    await user.type(screen.getByTestId('reset-password'), 'NewPassword1!')
    await user.type(screen.getByTestId('reset-password-confirm'), 'Different1!')

    expect(screen.getByTestId('reset-password-submit')).toBeDisabled()
  })

  it('Given a weak password, When fields are filled, Then submit stays disabled and hints stay unmet', async () => {
    const user = userEvent.setup()
    renderResetPage()

    await user.type(screen.getByTestId('reset-password'), 'short1')
    await user.type(screen.getByTestId('reset-password-confirm'), 'short1')

    expect(screen.getByTestId('reset-password-submit')).toBeDisabled()
    expect(screen.getByTestId('password-requirement-minLength')).toHaveAttribute('data-met', 'false')
  })

  it('Given typing a strong password, When requirements are met, Then hints turn met and show toggle reveals text', async () => {
    const user = userEvent.setup()
    renderResetPage()

    await user.type(screen.getByTestId('reset-password'), 'NewPassword1!')

    expect(screen.getByTestId('password-requirement-minLength')).toHaveAttribute('data-met', 'true')
    expect(screen.getByTestId('password-requirement-letterAndNumber')).toHaveAttribute(
      'data-met',
      'true',
    )
    expect(screen.getByTestId('password-requirement-upperAndLower')).toHaveAttribute(
      'data-met',
      'true',
    )
    expect(screen.getByTestId('password-requirement-special')).toHaveAttribute('data-met', 'true')

    expect(screen.getByTestId('reset-password')).toHaveAttribute('type', 'password')
    await user.click(screen.getByTestId('reset-password-toggle'))
    expect(screen.getByTestId('reset-password')).toHaveAttribute('type', 'text')
  })

  it('Given matching strong passwords, When submit is enabled, Then user can proceed', async () => {
    const user = userEvent.setup()
    renderResetPage()

    await user.type(screen.getByTestId('reset-password'), 'NewPassword1!')
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewPassword1!')

    expect(screen.getByTestId('reset-password-submit')).toBeEnabled()
  })

  it('Given no token in URL, When page loads, Then shows invalid link error', () => {
    renderResetPage(null)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Password reset link is invalid or has expired.',
    )
    expect(screen.getByTestId('reset-password-submit')).toBeDisabled()
    expect(
      screen.getByRole('link', { name: 'Request a new reset link' }),
    ).toHaveAttribute('href', '/forgot-password')
  })

  it('Given a token the server rejects as expired, When submitting, Then offers a new-reset action and blocks retry', async () => {
    const user = userEvent.setup()
    const { postResetPassword, ApiError } = await import('../../api/client')
    vi.mocked(postResetPassword).mockRejectedValueOnce(
      new ApiError(400, {
        type: 'https://leaveo.net/errors/reset-token-invalid',
      }),
    )
    renderResetPage('expired-token')

    // The link is present in the URL, so the missing-token branch does not apply.
    expect(
      screen.queryByRole('link', { name: 'Request a new reset link' }),
    ).not.toBeInTheDocument()

    await user.type(screen.getByTestId('reset-password'), 'NewPassword1!')
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewPassword1!')
    await user.click(screen.getByTestId('reset-password-submit'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password reset link is invalid or has expired.',
    )
    // AC4: explain the link is unusable *and* provide a new-reset action.
    expect(
      screen.getByRole('link', { name: 'Request a new reset link' }),
    ).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByTestId('reset-password-submit')).toBeDisabled()
    expect(screen.getByTestId('reset-password')).toHaveValue('')
  })
})
