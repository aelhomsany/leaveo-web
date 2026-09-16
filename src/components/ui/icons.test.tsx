import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LeaveoLogo, LeaveoSymbol } from './icons'

describe('Leaveo brand artwork', () => {
  it('[P1] names the logo when labelled and hides it from assistive technology otherwise', () => {
    const { container } = render(
      <>
        <LeaveoLogo label="Leaveo" />
        <LeaveoSymbol />
      </>,
    )

    expect(screen.getByRole('img', { name: 'Leaveo' })).toBeInTheDocument()
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  })

  it('[P1] keeps the brand kit proportions for both lockups', () => {
    const { container } = render(
      <>
        <LeaveoLogo width={132} />
        <LeaveoLogo layout="stacked" />
      </>,
    )
    const [horizontal, stacked] = container.querySelectorAll('svg')

    expect(horizontal).toHaveAttribute('viewBox', '0 0 440 136')
    expect(horizontal).toHaveAttribute('height', '40.8')
    expect(stacked).toHaveAttribute('viewBox', '0 0 280 224')
    expect(stacked).toHaveAttribute('width', '140')
    expect(stacked).toHaveAttribute('height', '112')
  })

  it('[P1] reverse tone turns the L and wordmark white but keeps the teal pause bar', () => {
    const { container } = render(<LeaveoLogo tone="reverse" />)

    expect(container.querySelector('path')).toHaveAttribute('fill', '#FFFFFF')
    expect(container.querySelector('rect')).toHaveAttribute('fill', '#22A699')
    expect(container.querySelector('g[stroke]')).toHaveAttribute('stroke', '#FFFFFF')
  })
})
