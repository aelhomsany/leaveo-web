import { LeaveoLogo } from '../../components/ui/icons'
import ar from '../../i18n/locales/ar/public.json'
import en from '../../i18n/locales/en/public.json'
import { ConsentPreference } from './consent/ConsentPreference'
import { PublicEvidence, type PublicLocale } from './PublicEvidence'
import type { PublicRoutePath } from './publicRoutes'
import { PricingRecommendation } from './pricing/PricingRecommendation'
import { ContactSalesForm } from './contact-sales/ContactSalesForm'
import { RegistrationFlow } from '../registration/RegistrationFlow'
import { CheckoutReturnPage } from '../billing/CheckoutReturnPage'

const publicCtaEnabled = import.meta.env.VITE_PUBLIC_CTA_ENABLED !== 'false'

/**
 * Sign-in lives in the customer app, which is a different artifact on a different origin — the
 * public site serves no /login route, so a relative href resolved against this origin and landed
 * every "Customer Log In" on the public 404. Left empty the links stay relative, which is what a
 * single-host deployment (and the multiplexed dev server) wants; point it at the app origin
 * wherever the two are actually split.
 */
const appBaseUrl = (import.meta.env.VITE_PUBLIC_APP_BASE_URL ?? '').replace(/\/$/, '')

function appUrl(path: string): string {
  return `${appBaseUrl}${path}`
}

type PublicDictionary = typeof en

type PublicPageProps = {
  locale: PublicLocale
  route: PublicRoutePath | '/404'
  staticConsent?: boolean
}

function localePath(locale: PublicLocale, route: string): string {
  if (locale === 'ar') {
    return route === '/' ? '/ar/' : `/ar${route}`
  }
  return route
}

function alternateLocalePath(locale: PublicLocale, route: string): string {
  return localePath(locale === 'en' ? 'ar' : 'en', route)
}

function PublicHeader({
  locale,
  route,
  copy,
}: {
  locale: PublicLocale
  route: string
  copy: PublicDictionary
}) {
  const nav = copy.navigation
  return (
    <header className="public-header">
      <div className="public-header__inner">
        <a
          className="public-brand"
          href={localePath(locale, '/')}
          aria-label={copy.brand.homeLabel}
        >
          <LeaveoLogo />
        </a>

        <nav className="public-nav" aria-label={nav.label}>
          <a href={localePath(locale, '/product')}>{nav.product}</a>
          <a href={localePath(locale, '/pricing')}>{nav.pricing}</a>
          <a href={localePath(locale, '/distributed-teams')}>
            {nav.distributedTeams}
          </a>
          <a href={localePath(locale, '/security')}>{nav.security}</a>
        </nav>

        <div className="public-header__actions">
          <a
            className="public-language"
            href={alternateLocalePath(locale, route)}
            hrefLang={locale === 'en' ? 'ar' : 'en'}
            lang={locale === 'en' ? 'ar' : 'en'}
            aria-label={nav.languageLabel}
          >
            {nav.language}
          </a>
          <a className="btn btn-outline public-login" href={appUrl('/login')}>
            {nav.login}
          </a>
          {publicCtaEnabled ? (
            <a
              className="btn btn-primary public-start-free"
              href={`${localePath(locale, '/pricing')}?intendedCount=5`}
            >
              {nav.startFree}
            </a>
          ) : null}
        </div>
      </div>
    </header>
  )
}

function Availability({
  copy,
  compact = false,
}: {
  copy: PublicDictionary
  compact?: boolean
}) {
  return (
    <section
      className={`public-availability${compact ? ' public-availability--compact' : ''}`}
      aria-labelledby="availability-title"
    >
      <p className="public-eyebrow">{copy.availability.eyebrow}</p>
      <h2 id="availability-title">{copy.availability.title}</h2>
      <p>{copy.availability.body}</p>
      <div className="public-action-row">
        <a className="btn btn-primary" href={copy.availability.pricingHref}>
          {copy.actions.viewPricing}
        </a>
        <a className="btn btn-outline" href={copy.availability.contactHref}>
          {copy.actions.contactSales}
        </a>
      </div>
      <small>{copy.availability.note}</small>
    </section>
  )
}

function HomePage({ copy, locale }: { copy: PublicDictionary; locale: PublicLocale }) {
  return (
    <>
      <section className="public-hero public-container">
        <div className="public-hero__copy">
          <p className="public-eyebrow">{copy.home.eyebrow}</p>
          <h1>{copy.home.title}</h1>
          <p className="public-lede">{copy.home.intro}</p>
          {publicCtaEnabled ? (
            <div className="public-action-row">
              <a className="btn btn-primary" href={localePath(locale, '/product')}>
                {copy.actions.exploreProduct}
              </a>
              <a className="btn btn-outline" href={appUrl('/login')}>
                {copy.actions.customerLogin}
              </a>
            </div>
          ) : null}
        </div>
        <PublicEvidence locale={locale} />
      </section>

      <section className="public-section public-section--mist">
        <div className="public-container public-split">
          <div>
            <p className="public-eyebrow">{copy.navigation.distributedTeams}</p>
            <h2>{copy.home.distributedTitle}</h2>
          </div>
          <p className="public-lede">{copy.home.distributedBody}</p>
        </div>
      </section>

      <section className="public-section public-container public-fit">
        <h2>{copy.home.fitTitle}</h2>
        <ul>
          {copy.home.fitItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <div className="public-container">
        <Availability copy={copy} />
      </div>
    </>
  )
}

function ProductPage({ copy, locale }: { copy: PublicDictionary; locale: PublicLocale }) {
  return (
    <>
      <Intro
        eyebrow={copy.product.eyebrow}
        title={copy.product.title}
        intro={copy.product.intro}
      />
      <div className="public-container">
        <PublicEvidence locale={locale} />
      </div>
      <section className="public-section public-container">
        <h2>{copy.product.stepsTitle}</h2>
        <ol className="public-steps">
          {copy.product.steps.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="public-section public-section--mist">
        <div className="public-container public-prose">
          <h2>{copy.product.fitTitle}</h2>
          <p>{copy.product.fitBody}</p>
        </div>
      </section>
      <div className="public-container">
        <Availability copy={copy} compact />
      </div>
    </>
  )
}

function DistributedTeamsPage({
  copy,
  locale,
}: {
  copy: PublicDictionary
  locale: PublicLocale
}) {
  return (
    <>
      <Intro
        eyebrow={copy.distributedTeams.eyebrow}
        title={copy.distributedTeams.title}
        intro={copy.distributedTeams.intro}
      />
      <section className="public-section public-container">
        <h2>{copy.distributedTeams.comparisonTitle}</h2>
        <div className="public-policy-grid">
          <article>
            <h3>{copy.distributedTeams.groupOneTitle}</h3>
            <p>{copy.distributedTeams.groupOneBody}</p>
          </article>
          <article>
            <h3>{copy.distributedTeams.groupTwoTitle}</h3>
            <p>{copy.distributedTeams.groupTwoBody}</p>
          </article>
        </div>
      </section>
      <div className="public-container">
        <PublicEvidence locale={locale} proofType="distributed-team" />
      </div>
      <section className="public-section public-section--mist">
        <div className="public-container public-prose">
          <h2>{copy.distributedTeams.consequenceTitle}</h2>
          <p>{copy.distributedTeams.consequenceBody}</p>
        </div>
      </section>
      <div className="public-container">
        <Availability copy={copy} compact />
      </div>
    </>
  )
}

function WorkingDaysPage({
  copy,
  locale,
}: {
  copy: PublicDictionary
  locale: PublicLocale
}) {
  return (
    <>
      <Intro
        eyebrow={copy.workingDays.eyebrow}
        title={copy.workingDays.title}
        intro={copy.workingDays.intro}
      />
      <div className="public-container">
        <PublicEvidence locale={locale} />
      </div>
      <section className="public-section public-container public-prose">
        <h2>{copy.distributedTeams.consequenceTitle}</h2>
        <p>{copy.distributedTeams.consequenceBody}</p>
        {publicCtaEnabled ? (
          <a className="btn btn-outline" href={localePath(locale, '/distributed-teams')}>
            {copy.navigation.distributedTeams}
          </a>
        ) : null}
      </section>
      <div className="public-container">
        <Availability copy={copy} compact />
      </div>
    </>
  )
}

function SecurityPage({ copy }: { copy: PublicDictionary }) {
  return (
    <>
      <Intro
        eyebrow={copy.security.eyebrow}
        title={copy.security.title}
        intro={copy.security.intro}
      />
      <section className="public-section public-container">
        <h2>{copy.security.principlesTitle}</h2>
        <div className="public-principles">
          {copy.security.principles.map((principle) => (
            <article key={principle.title}>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </article>
          ))}
        </div>
        <p className="public-security-note">{copy.security.operatorNote}</p>
      </section>
      <div className="public-container">
        <Availability copy={copy} compact />
      </div>
    </>
  )
}

function PrivacyPage({ copy }: { copy: PublicDictionary }) {
  return (
    <>
      <Intro
        eyebrow={copy.privacy.eyebrow}
        title={copy.privacy.title}
        intro={copy.privacy.intro}
      />
      <article className="public-section public-container public-legal">
        <p>
          <strong>{copy.privacy.versionLabel}:</strong> <bdi>{copy.privacy.version}</bdi>
        </p>
        <h2>{copy.privacy.necessaryTitle}</h2>
        <p>{copy.privacy.necessaryBody}</p>
        <h2>{copy.privacy.analyticsTitle}</h2>
        <p>{copy.privacy.analyticsBody}</p>
        <h2>{copy.privacy.changeTitle}</h2>
        <p>{copy.privacy.changeBody}</p>
        <a className="btn btn-outline" href="#privacy-choices">
          {copy.actions.privacyChoices}
        </a>
      </article>
    </>
  )
}

function TermsPage({ copy }: { copy: PublicDictionary }) {
  return (
    <>
      <Intro
        eyebrow={copy.terms.eyebrow}
        title={copy.terms.title}
        intro={copy.terms.intro}
      />
      <article className="public-section public-container public-legal">
        <p>
          <strong>{copy.terms.versionLabel}:</strong> <bdi>{copy.terms.version}</bdi>
        </p>
        {copy.terms.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </article>
    </>
  )
}

function PricingPage({ copy, locale }: { copy: PublicDictionary; locale: PublicLocale }) {
  return (
    <>
      <Intro
        eyebrow={copy.pricing.eyebrow}
        title={copy.pricing.title}
        intro={copy.pricing.intro}
      />
      <div className="public-container" id="pricing-island">
        <PricingRecommendation locale={locale} />
      </div>
    </>
  )
}

function ContactSalesPage({ copy, locale }: { copy: PublicDictionary; locale: PublicLocale }) {
  return (
    <>
      <Intro
        eyebrow={copy.contactSales.eyebrow}
        title={copy.contactSales.title}
        intro={copy.contactSales.intro}
      />
      <div className="contact-sales-layout public-container">
        <aside className="contact-sales-context" aria-labelledby="contact-sales-context-title">
          <h2 id="contact-sales-context-title">{copy.contactSales.contextTitle}</h2>
          <p>{copy.contactSales.contextBody}</p>
          <ul>
            {copy.contactSales.contextPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </aside>
        <div id="contact-sales-island">
          <ContactSalesForm locale={locale} />
        </div>
      </div>
    </>
  )
}

function NotFoundPage({ copy, locale }: { copy: PublicDictionary; locale: PublicLocale }) {
  return (
    <section className="public-not-found public-container" data-testid="public-not-found">
      <p className="public-eyebrow">404</p>
      <h1>{copy.notFound.title}</h1>
      <p className="public-lede">{copy.notFound.body}</p>
      <div className="public-action-row">
        <a className="btn btn-primary" href={localePath(locale, '/')}>
          {copy.actions.backHome}
        </a>
        <a className="btn btn-outline" href={localePath(locale, '/product')}>
          {copy.navigation.product}
        </a>
      </div>
    </section>
  )
}

function Intro({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string
  title: string
  intro: string
}) {
  return (
    <section className="public-intro public-container">
      <p className="public-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="public-lede">{intro}</p>
    </section>
  )
}

function PublicFooter({
  copy,
  locale,
}: {
  copy: PublicDictionary
  locale: PublicLocale
}) {
  return (
    <>
      <div id="privacy-choices" className="public-consent-slot">
        <ConsentPreference locale={locale} hydrateSafe />
      </div>
      <footer className="public-footer">
        <div className="public-footer__inner public-container">
          <div>
            <strong>{copy.brand.name}</strong>
            <p>{copy.footer.summary}</p>
          </div>
          <nav aria-label={copy.footer.label}>
            <a href={localePath(locale, '/pricing')}>{copy.navigation.pricing}</a>
            <a href={localePath(locale, '/contact-sales')}>{copy.actions.contactSales}</a>
            <a href={localePath(locale, '/security')}>{copy.footer.security}</a>
            <a href={localePath(locale, '/privacy')}>{copy.footer.privacy}</a>
            <a href={localePath(locale, '/terms')}>{copy.footer.terms}</a>
          </nav>
          <p>{copy.footer.copyright}</p>
        </div>
      </footer>
    </>
  )
}

export function PublicPage({ locale, route }: PublicPageProps) {
  const copy = (locale === 'ar' ? ar : en) as PublicDictionary
  const normalizedRoute = route === '/404' ? '/' : route

  let content
  switch (route) {
    case '/':
      content = <HomePage copy={copy} locale={locale} />
      break
    case '/product':
      content = <ProductPage copy={copy} locale={locale} />
      break
    case '/distributed-teams':
      content = <DistributedTeamsPage copy={copy} locale={locale} />
      break
    case '/working-day-transparency':
      content = <WorkingDaysPage copy={copy} locale={locale} />
      break
    case '/security':
      content = <SecurityPage copy={copy} />
      break
    case '/pricing':
      content = <PricingPage copy={copy} locale={locale} />
      break
    case '/contact-sales':
      content = <ContactSalesPage copy={copy} locale={locale} />
      break
    case '/register':
    case '/register/verify':
    case '/register/recovery':
      content = <div id="registration-island"><RegistrationFlow locale={locale} route={route} /></div>
      break
    case '/register/checkout-return':
      content = <div id="checkout-return-island"><CheckoutReturnPage locale={locale} /></div>
      break
    case '/privacy':
      content = <PrivacyPage copy={copy} />
      break
    case '/terms':
      content = <TermsPage copy={copy} />
      break
    default:
      content = <NotFoundPage copy={copy} locale={locale} />
  }

  return (
    <div className="public-site">
      <a className="skip-to-main sr-only" href="#public-main">
        {copy.navigation.skip}
      </a>
      <PublicHeader locale={locale} route={normalizedRoute} copy={copy} />
      <main id="public-main" tabIndex={-1}>
        {content}
      </main>
      <PublicFooter copy={copy} locale={locale} />
    </div>
  )
}
