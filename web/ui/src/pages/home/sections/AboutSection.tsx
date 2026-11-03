import { usePageConfig } from '../../../config/context'
import { conditionsOf } from '../../../domain/conditions/parse'
import { howOftenText } from '../../../domain/freshness/cadence'
import { newestCheckText } from '../../../domain/freshness/refresh'
import { inOrder } from '../../../domain/status/trend'
import { workingMeaning } from '../../../domain/working/working'
import home from '../home.module.css'
import type { HomeView } from '../useHomeView'

/** "Checks run from one location in India. ..." when the page setting names a place. */
function whereText(place: string, browserCheck: boolean): string | null {
  if (place === '') {
    return null
  }
  const tip = browserCheck
    ? ' A problem that affects only some networks or countries may not show here; use “Is it just me?” to test from yours.'
    : ' A problem that affects only some networks or countries may not show here.'
  return `Checks run from ${place}.${tip}`
}

function WorkingList({ view }: { view: HomeView }) {
  const items = view.inputs.flatMap((input) => {
    const meaning = workingMeaning(conditionsOf(inOrder(input.results).at(-1)))
    if (meaning.sentence === null && meaning.unrecognised.length === 0) {
      return []
    }
    return [{ key: input.key, name: input.name, meaning }]
  })
  if (items.length === 0) {
    return null
  }
  return (
    <>
      <dt>What “working” means</dt>
      <dd>
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <strong>{item.name}:</strong> {item.meaning.sentence}
              {item.meaning.unrecognised.map((condition) => (
                <code key={condition}> {condition}</code>
              ))}
            </li>
          ))}
        </ul>
      </dd>
    </>
  )
}

/** "About this page": where and how often checks run, what working means, privacy, source (spec 4.1 item 7). */
export function AboutSection({ view }: { view: HomeView }) {
  const { checksLocation, browserChecks, sourceLink, feeds } = usePageConfig()
  const browserCheck = browserChecks.length > 0
  const where = whereText(checksLocation, browserCheck)
  const often = howOftenText(view.inputs)
  const ready = view.phase === 'ready'
  return (
    <section id="about" className={home.part ?? ''} aria-labelledby="about-heading">
      <h2 id="about-heading" className={home.h2 ?? ''} tabIndex={-1}>
        About this page
      </h2>
      <div className={`${home.box ?? ''} ${home.padded ?? ''}`}>
        <dl className={home.dl ?? ''}>
          {where === null ? null : (
            <>
              <dt>Where checks run</dt>
              <dd>{where}</dd>
            </>
          )}
          {ready && often !== null ? (
            <>
              <dt>How often</dt>
              <dd>{often}</dd>
            </>
          ) : null}
          {ready && view.travel === null ? (
            <>
              <dt>Newest check</dt>
              <dd>{newestCheckText(view.newest, view.now)}</dd>
            </>
          ) : null}
          {ready ? <WorkingList view={view} /> : null}
          <dt>Your privacy</dt>
          <dd>
            No tracking and no third-party scripts. One cookie remembers your theme.
            {browserCheck
              ? ' The browser check runs only when you ask, and its result is not sent anywhere.'
              : ''}
          </dd>
          <dt>Source and feeds</dt>
          <dd>
            <a href={sourceLink} rel="noopener">
              Source code (Apache 2.0)
            </a>
            .
            {feeds ? (
              <>
                {' '}
                Updates by <a href="/feed/atom.xml">Atom</a>, <a href="/feed/rss.xml">RSS</a> or{' '}
                <a href="/feed/feed.json">JSON Feed</a>.
              </>
            ) : null}
          </dd>
        </dl>
      </div>
    </section>
  )
}
