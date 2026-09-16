import { type KeyboardEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HorizontalScrollRegion } from '../../components/ui/HorizontalScrollRegion'
import {
  SETTINGS_CATEGORIES,
  type SettingsCategory,
} from './settingsCategories'

type SettingsCategoryNavProps = {
  activeCategory: SettingsCategory
  // Returns whether the switch actually applied. When a dirty draft defers it
  // behind the unsaved-changes modal, callers must not chase focus/scroll to
  // a tab that isn't really selected yet.
  onSelect: (category: SettingsCategory) => boolean
}

function useNarrowSettingsNavigation() {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? false
      : window.matchMedia('(max-width: 900px)').matches,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined
    }
    const query = window.matchMedia('(max-width: 900px)')
    const update = () => setIsNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isNarrow
}

export function SettingsCategoryNav({
  activeCategory,
  onSelect,
}: SettingsCategoryNavProps) {
  const { t, i18n } = useTranslation('settings')
  const isNarrow = useNarrowSettingsNavigation()

  useEffect(() => {
    if (!isNarrow) {
      return
    }
    document
      .getElementById(`settings-category-${activeCategory}`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [activeCategory, isNarrow])

  const activateCategory = (category: SettingsCategory) => {
    const applied = onSelect(category)
    if (!applied) {
      // A dirty draft deferred this behind the unsaved-changes modal — leave
      // focus where it is instead of desyncing it from the visible/ARIA
      // selection (the modal takes focus on its own once it opens).
      return
    }
    const tab = document.getElementById(`settings-category-${category}`)
    tab?.focus()
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const lastIndex = SETTINGS_CATEGORIES.length - 1
    let nextIndex: number | null = null

    if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = lastIndex
    } else if (!isNarrow && event.key === 'ArrowDown') {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1
    } else if (!isNarrow && event.key === 'ArrowUp') {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1
    } else if (isNarrow) {
      const forwardKey = i18n.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
      const backwardKey = i18n.dir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
      if (event.key === forwardKey) {
        nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1
      } else if (event.key === backwardKey) {
        nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1
      }
    }

    if (nextIndex == null) {
      return
    }

    event.preventDefault()
    activateCategory(SETTINGS_CATEGORIES[nextIndex])
  }

  return (
    <aside className="settings-category-rail">
      <h2 id="settings-category-nav-label" className="sr-only">
        {t('categories.ariaLabel')}
      </h2>
      <p className="settings-category-label" aria-hidden="true">{t('categories.sectionLabel')}</p>
      <HorizontalScrollRegion
        className="settings-category-scroll"
        describedById="settings-category-scroll-hint"
        labelledBy="settings-category-nav-label"
        testId="settings-category-nav"
        hintKey="categoryRail.scrollHint"
      >
        <div
          className="settings-category-tabs"
          role="tablist"
          aria-labelledby="settings-category-nav-label"
          aria-orientation={isNarrow ? 'horizontal' : 'vertical'}
        >
          {SETTINGS_CATEGORIES.map((category, index) => {
            const selected = category === activeCategory
            return (
              <button
                key={category}
                id={`settings-category-${category}`}
                type="button"
                role="tab"
                aria-selected={selected}
                // Only the active category's panel is mounted (AC11) — do not
                // point aria-controls at an id that isn't in the DOM.
                aria-controls={selected ? `settings-panel-${category}` : undefined}
                tabIndex={selected ? 0 : -1}
                className={`settings-category-tab${selected ? ' is-active' : ''}`}
                data-testid={`settings-category-${category}`}
                onClick={() => activateCategory(category)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <span className="settings-category-number" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{t(`categories.items.${category}.label`)}</span>
              </button>
            )
          })}
        </div>
      </HorizontalScrollRegion>
      <p className="settings-category-overflow-cue" aria-hidden="true">
        {t('categories.scrollCue')}
      </p>
    </aside>
  )
}
