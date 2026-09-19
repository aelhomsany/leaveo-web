import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LanguageSwitcher } from './LanguageSwitcher'

describe('LanguageSwitcher ATDD — Story 9.4', () => {
  it.todo('[P1] Desktop language switcher (Globe button + label) in Header', () => {
    // The shipped component takes a `compact` boolean, not a `variant` string --
    // this scaffold predates that API (still a RED-phase todo, never executed).
    render(<LanguageSwitcher compact={false} />)

    const button = screen.getByRole('button', { name: /change language/i })
    expect(button).toBeInTheDocument()
    expect(screen.getByTestId('globe-icon')).toBeInTheDocument()
  })

  it.todo('[P1] Mobile language picker inside UserMenu', () => {
    render(<LanguageSwitcher compact />)

    // Mobile uses a list or combobox inside the UserMenu drawer
    expect(screen.getByRole('combobox', { name: /select language/i })).toBeInTheDocument()
  })
})
