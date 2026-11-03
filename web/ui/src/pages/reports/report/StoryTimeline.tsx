import {
  AlertIcon,
  CheckCircleIcon,
  DotFillIcon,
  XCircleIcon,
  type Icon,
} from '@primer/octicons-react'
import { Label, Timeline } from '@primer/react'
import { FeatureFlags } from '@primer/react/experimental'

import type { Tone } from '../../../domain/status/service'
import type { StoryItem } from '../../../domain/story/story'
import { utcClockNear } from '../../../domain/time/format'
import commonStyles from '../common/common.module.css'

import styles from './report.module.css'

const icons = new Map<Tone, Icon>([
  ['danger', XCircleIcon],
  ['severe', AlertIcon],
  ['attention', AlertIcon],
  ['success', CheckCircleIcon],
  ['neutral', DotFillIcon],
])

const badges = new Map<Tone, string | undefined>([
  ['danger', styles.badgeDanger],
  ['severe', styles.badgeSevere],
  ['attention', styles.badgeAttention],
  ['success', styles.badgeSuccess],
  ['neutral', styles.badgeNeutral],
])

const listSemantics = { primer_react_timeline_list_semantics: true }

export interface StoryTimelineProps {
  items: StoryItem[]
  /** Times on this UTC day read as a bare clock time. */
  reference: number
}

/** The story: what the checks measured and what the report said, oldest first. */
export function StoryTimeline({ items, reference }: StoryTimelineProps) {
  // Primer renders the timeline as a real list only behind this flag.
  return (
    <FeatureFlags flags={listSemantics}>
      <Timeline className={styles.timeline ?? ''}>
        {items.map((item) => {
          const ItemIcon = icons.get(item.tone) ?? DotFillIcon
          return (
            <Timeline.Item key={`${String(item.at)} ${item.source} ${item.text}`}>
              <Timeline.Badge className={badges.get(item.tone) ?? ''}>
                <ItemIcon aria-hidden="true" />
              </Timeline.Badge>
              <Timeline.Body>
                <p className={styles.when ?? ''}>
                  <Label variant="secondary">{item.source}</Label>{' '}
                  <span className="num">{utcClockNear(item.at, reference)}</span>
                </p>
                <p className={commonStyles.text ?? ''}>{item.text}</p>
              </Timeline.Body>
            </Timeline.Item>
          )
        })}
      </Timeline>
    </FeatureFlags>
  )
}
