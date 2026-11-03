import { AlertIcon, ToolsIcon, XCircleIcon, type Icon } from '@primer/octicons-react'
import { Label, Timeline } from '@primer/react'
import { Link } from 'react-router'

import { When } from '../../../components/When/When'
import type { Tone } from '../../../domain/status/service'
import type { StoryItem } from '../../../domain/story/story'
import home from '../home.module.css'

export interface StorySectionProps {
  items: StoryItem[]
  reference: number
  past: boolean
}

const icons: Record<Tone, Icon> = {
  danger: XCircleIcon,
  severe: AlertIcon,
  attention: AlertIcon,
  neutral: ToolsIcon,
  success: AlertIcon,
}

/** "What is happening": one Timeline, oldest first, each item with its source (spec 4.1 item 4). */
export function StorySection({ items, reference, past }: StorySectionProps) {
  if (items.length === 0) {
    return null
  }
  return (
    <section id="story" className={home.part ?? ''} aria-labelledby="story-heading">
      <h2 id="story-heading" className={home.h2 ?? ''} tabIndex={-1}>
        {past ? 'What was happening at that moment' : 'What is happening'}
      </h2>
      <p className={home.sub ?? ''}>
        One story from the checks, reports and maintenance schedule, oldest first.
      </p>
      <div className={`${home.box ?? ''} ${home.padded ?? ''}`}>
        <Timeline clipSidebar>
          {items.map((item, index) => {
            const Glyph = icons[item.tone]
            return (
              // Items have no id of their own; their order is fixed by time.
              // eslint-disable-next-line react/no-array-index-key
              <Timeline.Item key={index} condensed>
                <Timeline.Badge>
                  <Glyph aria-hidden="true" className={home[`tone-${item.tone}`] ?? ''} />
                </Timeline.Badge>
                <Timeline.Body>
                  <span className={home.storyMeta ?? ''}>
                    <Label variant="secondary">{item.source}</Label>
                    <When ms={item.at} reference={reference} />
                  </span>
                  <span className={home.storyText ?? ''}>{item.text}</span>
                  {item.reportId === null ? null : (
                    <Link to={`/reports/${encodeURIComponent(item.reportId)}`}>
                      Read the report
                    </Link>
                  )}
                </Timeline.Body>
              </Timeline.Item>
            )
          })}
        </Timeline>
      </div>
    </section>
  )
}
