import { Button, Label } from '@primer/react'
import { useState } from 'react'
import { Link } from 'react-router'

import { When } from '../../../components/When/When'
import {
  noNoticesText,
  noticeLabel,
  pastNotices,
  pastNoticesDays,
  type NoticeItem,
} from '../../../domain/notices/past'
import { recordDays } from '../../../domain/record/record'
import { utcClockNear, utcDay } from '../../../domain/time/format'
import home from '../home.module.css'
import type { HomeView } from '../useHomeView'

function Notice({ item, reference }: { item: NoticeItem; reference: number }) {
  const stage = item.kind === 'report' ? item.stage : null
  return (
    <p className={home.notice ?? ''}>
      <Label variant={stage === 'resolved' ? 'success' : 'secondary'}>{noticeLabel(item)}</Label>
      <span className={home.muted ?? ''}>
        <When ms={item.at} reference={reference} />
      </span>
      {item.kind === 'report' ? (
        <Link to={`/reports/${encodeURIComponent(item.id)}`}>{item.title}</Link>
      ) : (
        <span>
          {item.title}
          {item.state === 'in-progress' ? `, until ${utcClockNear(item.end, reference)}` : ''}
        </span>
      )}
    </p>
  )
}

/** "Past notices": reports and maintenance of the last 14 days, newest first (spec 4.1 item 6). */
export function PastNotices({ view }: { view: HomeView }) {
  const [days, setDays] = useState(pastNoticesDays)
  const list = pastNotices({
    reports: view.reports,
    windows: view.windows,
    end: view.reference,
    days,
  })
  return (
    <>
      <h3 className={home.h3 ?? ''}>Past notices</h3>
      <div className={home.box ?? ''}>
        <ul className={home.days ?? ''}>
          {list.map((day) => (
            <li key={day.start}>
              <h4 className={home.h4 ?? ''}>{utcDay(day.start)}</h4>
              {view.noticesFailed !== null && day.items.length === 0 ? (
                <p className={`${home.notice ?? ''} ${home.muted ?? ''}`}>
                  Not available right now.
                </p>
              ) : null}
              {view.noticesFailed === null && day.items.length === 0 ? (
                <p className={`${home.notice ?? ''} ${home.muted ?? ''}`}>{noNoticesText}</p>
              ) : null}
              {day.items.map((item) => (
                <Notice
                  key={`${item.kind}-${item.title}-${String(item.at)}`}
                  item={item}
                  reference={view.reference}
                />
              ))}
            </li>
          ))}
        </ul>
      </div>
      <div className={home.more ?? ''}>
        {days < recordDays ? (
          <Button
            onClick={() => {
              setDays(Math.min(recordDays, days + pastNoticesDays))
            }}
          >
            Show older notices
          </Button>
        ) : null}
        <Link to="/reports">All reports</Link>
      </div>
    </>
  )
}
