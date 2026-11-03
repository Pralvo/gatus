import { SkeletonText } from '@primer/react/experimental'

import { Section } from '../../components/PageHead/Section'
import { conditionsOf } from '../../domain/conditions/parse'
import { normalFigures, type Figure } from '../../domain/panel/figures'
import { inOrder } from '../../domain/status/trend'
import { workingMeaning } from '../../domain/working/working'

import styles from './service.module.css'
import type { ServiceReady } from './useServiceView'

function FigureItem({ figure, loading }: { figure: Figure; loading: boolean }) {
  let value = <dd className={styles.unknown ?? ''}>Not known yet</dd>
  if (figure.value !== null) {
    value = <dd>{figure.value}</dd>
  } else if (loading) {
    value = (
      <dd aria-busy="true">
        <SkeletonText size="titleMedium" maxWidth="80px" />
      </dd>
    )
  }
  return (
    <div className={styles.figure ?? ''}>
      <dt>{figure.label}</dt>
      {value}
    </div>
  )
}

export interface NormalSectionProps {
  ready: ServiceReady
  /** In time travel Gatus has no 30-day share for the moment, so it is left out. */
  past: boolean
}

/** "Compared with normal": now, usual and failed checks in 30 days, with the sentence (spec 4.2 item 3). */
export function NormalSection({ ready, past }: NormalSectionProps) {
  const figures = normalFigures(ready.service.normal, ready.uptime)
  const shown = past ? figures.speeds : [...figures.speeds, figures.failed]
  return (
    <Section id="normal-heading" title="Compared with normal">
      {shown.length === 0 ? null : (
        <dl className={styles.figures ?? ''}>
          {shown.map((figure) => (
            <FigureItem
              key={figure.label}
              figure={figure}
              loading={figure === figures.failed && ready.uptimeLoading}
            />
          ))}
        </dl>
      )}
      <p className={styles.sentence ?? ''}>{figures.sentence}</p>
    </Section>
  )
}

/** "What working means": the check's conditions in words, and nothing about how it is built (spec 0 and 7). */
export function WorkingSection({ ready }: { ready: ServiceReady }) {
  const latest = inOrder(ready.input.results).at(-1)
  const meaning = workingMeaning(conditionsOf(latest))
  let text = meaning.sentence
  if (latest === undefined) {
    text = 'The first check has not finished yet, so what it tests is not known.'
  } else if (text === null && meaning.unrecognised.length === 0) {
    text = 'The check sets no conditions.'
  }
  return (
    <Section id="working-heading" title="What “working” means">
      {text === null ? null : <p className={styles.text ?? ''}>{text}</p>}
      {meaning.unrecognised.length === 0 ? null : (
        <>
          <p className={styles.text ?? ''}>
            {meaning.sentence === null ? 'It checks that:' : 'It also checks that:'}
          </p>
          <ul>
            {meaning.unrecognised.map((condition) => (
              <li key={condition}>
                <code className={styles.code ?? ''}>{condition}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}
