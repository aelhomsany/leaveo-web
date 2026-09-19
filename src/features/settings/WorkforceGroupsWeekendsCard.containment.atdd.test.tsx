import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as apiClient from '../../api/client'
import { AuthTestProvider, createMockAuthForRole } from '../../test/authTestUtils'
import { mockWorkforceGroup } from '../../test/apiFixtures'
import { SettingsCategoryNav } from './SettingsCategoryNav'
import { SETTINGS_CATEGORIES } from './settingsCategories'
import { WorkforceGroupsWeekendsCard } from './WorkforceGroupsWeekendsCard'

function mockNarrowViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 900px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <AuthTestProvider value={createMockAuthForRole('ORGANIZATION_ADMIN')}>
        <WorkforceGroupsWeekendsCard onSuccess={vi.fn()} onWarning={vi.fn()} />
      </AuthTestProvider>
    </QueryClientProvider>,
  )
}

/**
 * Story 10.9 — UXA-02 floor (structure): group nav stays keyboard-operable with visible
 * active state. Pixel clip at 390px is covered by Playwright.
 */
describe('WorkforceGroupsWeekendsCard containment ATDD — Story 10.9', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getTeamMembers').mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test(
    '[P1] group tabs expose selected state and remain keyboard-activatable',
    async () => {
      const user = userEvent.setup()
      vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
        mockWorkforceGroup({ id: 1, name: 'US' }),
        mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
        mockWorkforceGroup({ id: 3, name: 'Remote EMEA' }),
      ])
      vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([])

      renderCard()

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'US' })).toHaveAttribute('aria-selected', 'true')
      })

      const egyptTab = screen.getByRole('tab', { name: 'Egypt' })
      egyptTab.focus()
      expect(egyptTab).toHaveFocus()
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(egyptTab).toHaveAttribute('aria-selected', 'true')
        expect(egyptTab).toHaveClass('active')
      })

      expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Egypt')

      // Third tab proves multi-group reachability for the scroll-strip/select pattern.
      expect(screen.getByRole('tab', { name: 'Remote EMEA' })).toBeInTheDocument()
    },
  )

  test(
    '[P0] ArrowRight and ArrowLeft move tab selection with roving tabindex',
    async () => {
      const user = userEvent.setup()
      vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
        mockWorkforceGroup({ id: 1, name: 'US' }),
        mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
        mockWorkforceGroup({ id: 3, name: 'Remote EMEA' }),
      ])
      vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([])

      renderCard()

      const usTab = await screen.findByRole('tab', { name: 'US' })
      usTab.focus()
      expect(usTab).toHaveFocus()

      await user.keyboard('{ArrowRight}')

      const egyptTab = screen.getByRole('tab', { name: 'Egypt' })
      expect(egyptTab).toHaveFocus()
      expect(egyptTab).toHaveAttribute('aria-selected', 'true')
      expect(usTab).toHaveAttribute('tabindex', '-1')
      expect(egyptTab).toHaveAttribute('tabindex', '0')

      await user.keyboard('{ArrowLeft}')
      expect(usTab).toHaveFocus()
      expect(usTab).toHaveAttribute('aria-selected', 'true')
    },
  )

  test('[P0] Home and End jump to the first and last workforce group tabs', async () => {
    const user = userEvent.setup()
    vi.spyOn(apiClient, 'getWorkforceGroups').mockResolvedValue([
      mockWorkforceGroup({ id: 1, name: 'US' }),
      mockWorkforceGroup({ id: 2, name: 'Egypt', weekendDays: ['FRIDAY', 'SATURDAY'] }),
      mockWorkforceGroup({ id: 3, name: 'Remote EMEA' }),
    ])
    vi.spyOn(apiClient, 'getPublicHolidays').mockResolvedValue([])

    renderCard()

    const egyptTab = await screen.findByRole('tab', { name: 'Egypt' })
    egyptTab.focus()

    await user.keyboard('{End}')

    const lastTab = screen.getByRole('tab', { name: 'Remote EMEA' })
    expect(lastTab).toHaveFocus()
    expect(lastTab).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')

    const firstTab = screen.getByRole('tab', { name: 'US' })
    expect(firstTab).toHaveFocus()
    expect(firstTab).toHaveAttribute('aria-selected', 'true')
  })
})

/**
 * Story 11.5 — settings category rail/tablist containment at 390px. Same
 * structure-only floor as the Story 10.9 suite above: nothing is dropped and
 * the horizontal-scroll containment + narrow-mode keyboard mapping are wired
 * correctly. Actual pixel clip at 390px is covered by Playwright.
 */
describe('SettingsCategoryNav containment ATDD — Story 11.5', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test(
    '[P0] every category stays reachable via scroll containment at the 390px-class breakpoint',
    async () => {
      mockNarrowViewport()
      const onSelect = vi.fn().mockReturnValue(true)

      render(<SettingsCategoryNav activeCategory="working-calendars" onSelect={onSelect} />)

      const nav = screen.getByTestId('settings-category-nav')
      expect(nav).toHaveAttribute('role', 'region')
      // No categories dropped/truncated to fit the narrow strip. Derived from the registry
      // rather than a literal: the property under test is "every registered category is
      // reachable", which a hardcoded count silently stops checking each time one is added.
      expect(within(nav).getAllByRole('tab')).toHaveLength(SETTINGS_CATEGORIES.length)

      // Walk the whole registry forward instead of asserting two hardcoded neighbours. The
      // property is "every category is reachable by keyboard, in registration order" — spelling
      // out specific pairs meant every story that inserted a category had to patch this test,
      // and each patch quietly reduced what it still checked (Story 16.2).
      const first = screen.getByTestId(`settings-category-${SETTINGS_CATEGORIES[0]}`)
      first.focus()
      expect(first).toHaveFocus()

      for (let index = 1; index < SETTINGS_CATEGORIES.length; index += 1) {
        const previous = SETTINGS_CATEGORIES[index - 1]
        const expected = SETTINGS_CATEGORIES[index]
        // Dispatched at the freshly queried live button: selecting a category replaces the node
        // userEvent would otherwise hold a stale reference to.
        fireEvent.keyDown(screen.getByTestId(`settings-category-${previous}`), {
          key: 'ArrowRight',
        })
        await waitFor(() => {
          expect(screen.getByTestId(`settings-category-${expected}`)).toHaveFocus()
        })
        expect(onSelect).toHaveBeenLastCalledWith(expected)
      }
    },
  )
})
