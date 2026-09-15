import { render, screen } from '@testing-library/react'
import type { BalanceCardResponse } from '../../api/generated/types'
import { BalanceCard } from './BalanceCard'

const cappedBalance: BalanceCardResponse = {
  leaveTypeId: 1,
  name: 'Annual Leave',
  icon: '🌴',
  color: '#093C5D',
  backgroundColor: '#D6E8ED',
  borderColor: '#0E4F75',
  displayOrder: 1,
  capped: true,
  allocatedDays: 20,
  usedDays: 5,
  remainingDays: 15,
}

const uncappedBalance: BalanceCardResponse = {
  leaveTypeId: 5,
  name: 'Unpaid Leave',
  icon: '💼',
  color: '#5A7A80',
  backgroundColor: '#ECF4E8',
  borderColor: '#B8DCC4',
  displayOrder: 5,
  capped: false,
  allocatedDays: null,
  usedDays: 0,
  remainingDays: null,
}

const uncappedWithUsed: BalanceCardResponse = {
  ...uncappedBalance,
  usedDays: 3,
}

describe('BalanceCard', () => {
  it('renders capped card with tag, fraction, bar, and used footer', () => {
    render(<BalanceCard balance={cappedBalance} />)

    expect(screen.getByTestId('balance-card-annual-leave')).toBeInTheDocument()
    expect(screen.getByTestId('balance-tag-remaining-annual-leave')).toHaveClass('balance-tag--remaining')
    expect(screen.getByText('15 left')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('/20')).toBeInTheDocument()
    expect(screen.getByTestId('balance-bar-annual-leave')).toHaveStyle({ width: '25%' })
    expect(screen.getByText('5 working days used')).toBeInTheDocument()
  })

  it('labels uncapped state and keeps zero usage explicit', () => {
    render(<BalanceCard balance={uncappedBalance} />)

    expect(screen.getByTestId('balance-card-unpaid-leave')).toBeInTheDocument()
    expect(screen.queryByText(/left/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\//)).not.toBeInTheDocument()
    expect(screen.queryByTestId('balance-bar-unpaid-leave')).not.toBeInTheDocument()
    expect(screen.getByText('Uncapped leave')).toBeInTheDocument()
    expect(screen.getByText('0 working days used')).toBeInTheDocument()
  })

  it('shows informational used footer for uncapped card when usedDays > 0', () => {
    render(<BalanceCard balance={uncappedWithUsed} />)

    expect(screen.getByText('3 working days used')).toBeInTheDocument()
    expect(screen.queryByText(/left/)).not.toBeInTheDocument()
  })

  it('uses singular working-day copy for exactly one used day', () => {
    render(
      <BalanceCard
        balance={{
          ...cappedBalance,
          usedDays: 1,
          remainingDays: 19,
        }}
      />,
    )

    expect(screen.getByText('1 working day used')).toBeInTheDocument()
    expect(screen.queryByText('1 working days used')).not.toBeInTheDocument()
  })

  it('Plan RESTO: shows carried days, their deadline and the total, in the server numbers', () => {
    render(
      <BalanceCard
        balance={{
          ...cappedBalance,
          totalAvailableDays: 19,
          carryover: {
            sourceYear: 2025,
            capDays: 5,
            carriedDays: 5,
            usedDays: 1,
            remainingDays: 4,
            expiredDays: 0,
            expiresOn: '2026-03-31',
            expired: false,
          },
        }}
      />,
    )

    // The year is bidi-isolated, so the match allows the isolation marks around it.
    expect(screen.getByText(/^Carried from \W*2025\W*: 4 days left$/)).toBeInTheDocument()
    expect(screen.getByText(/Use carried days by/)).toHaveTextContent('Mar 31, 2026')
    expect(screen.getByText('19 days available in total')).toBeInTheDocument()
    expect(screen.getByTestId('balance-carryover-bar-annual-leave')).toHaveStyle({ width: '20%' })
  })

  it('Plan RESTO: names expired carried days instead of a deadline once it has passed', () => {
    render(
      <BalanceCard
        balance={{
          ...cappedBalance,
          totalAvailableDays: 15,
          carryover: {
            sourceYear: 2025,
            capDays: null,
            carriedDays: 5,
            usedDays: 2,
            remainingDays: 0,
            expiredDays: 3,
            expiresOn: '2026-03-31',
            expired: true,
          },
        }}
      />,
    )

    expect(screen.getByText(/3 carried days expired on/)).toBeInTheDocument()
    expect(screen.queryByText(/Use carried days by/)).not.toBeInTheDocument()
  })

  it('omits the progressbar when allocation has no valid range', () => {
    render(
      <BalanceCard
        balance={{
          ...cappedBalance,
          allocatedDays: 0,
          usedDays: 0,
          remainingDays: 0,
        }}
      />,
    )

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('/0')).toBeInTheDocument()
  })
})
