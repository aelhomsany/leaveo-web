import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n/config'
import { REPORT_DEFINITIONS, REPORT_SLUG_BY_KEY } from './reportDefinitions'
import { ReportCatalogPage } from './ReportCatalogPage'

function renderCatalog() {
  return render(
    <MemoryRouter>
      <ReportCatalogPage />
    </MemoryRouter>,
  )
}

describe('ReportCatalogPage', () => {
  beforeEach(async () => {
    if (i18n.language !== 'en') {
      await i18n.changeLanguage('en')
    }
  })

  it('[P0] offers every fixed report as its own linked card', () => {
    renderCatalog()

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(REPORT_DEFINITIONS.length)
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      REPORT_DEFINITIONS.map((definition) => `/reports/${REPORT_SLUG_BY_KEY[definition.key]}`),
    )
  })

  /*
    The slugs are a URL contract, not an implementation detail: they are what a bookmark, a
    shared link and a support article all hold. Asserting the literal set means renaming one
    fails here rather than silently breaking saved links.
  */
  it('[P0] keeps the report slugs stable', () => {
    expect(Object.values(REPORT_SLUG_BY_KEY).sort()).toEqual([
      'balance-snapshot',
      'carry-over',
      'exceptions',
      'leave-usage',
      'pending-aging',
      'request-detail',
    ])
  })

  /*
    A missing i18n key renders as an empty string in this app rather than throwing or showing
    the key, so `toBeVisible` on an empty node would pass while the card said nothing at all.
    Asserting the actual words is the only check that the catalog copy resolved.
  */
  it('[P0] renders translated report copy rather than blank nodes', () => {
    renderCatalog()

    expect(screen.getByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByText('Balance Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Pending Aging')).toBeInTheDocument()
    expect(
      screen.getByText('Approved leave usage across a required date range.'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('View full report')).toHaveLength(REPORT_DEFINITIONS.length)
  })

  it('[P1] names each card by its report and keeps the decorative preview out of that name', () => {
    renderCatalog()

    const card = screen.getByTestId('report-card-carry-over')
    expect(card).toHaveAccessibleName(/Carry-over/)
    // The preview is a miniature of the report's shape, not information: an SVG that reached
    // the accessibility tree would read as noise before every card's real name.
    expect(card.querySelector('.report-catalog-preview')).toHaveAttribute('aria-hidden', 'true')
  })
})
