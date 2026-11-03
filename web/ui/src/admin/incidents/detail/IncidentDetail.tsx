// One incident: severity, state and who opened it, the moves it allows, notes,
// its timeline and its details. A closed incident shows its record only.

import { AlertIcon, DotFillIcon, NoteIcon } from '@primer/octicons-react'
import { Label, Spinner, Timeline } from '@primer/react'
import { Link, useParams } from 'react-router'

import { useNow } from '../../../data/cycle'
import { entryText, isFrozen, severityWord, stateWord } from '../../../domain/admin/moves'
import { utcDateTime } from '../../../domain/time/format'
import type { AdminIncident } from '../../api/types'
import { failureText, useAdminIncident } from '../../data/queries'
import { AdminHeading, useDocumentTitle, When } from '../../shell/page'
import styles from '../incidents.module.css'

import { DetailsForm } from './DetailsForm'
import { MoveControl } from './MoveControl'
import { NoteForm } from './NoteForm'

function IncidentTimeline({ incident, now }: { incident: AdminIncident; now: number }) {
  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className={styles.h2 ?? ''}>
        Timeline, newest first
      </h2>
      <Timeline>
        {[...incident.timeline].reverse().map((entry) => (
          <Timeline.Item key={`${String(entry.seq)}-${String(entry.at)}`}>
            <Timeline.Badge>
              {entry.kind === 'note' ? <NoteIcon /> : <DotFillIcon />}
            </Timeline.Badge>
            <Timeline.Body>
              <p className={styles.meta ?? ''}>
                <span>
                  {entry.actor === '' ? 'Someone' : entry.actor} {entryText(entry)}
                </span>
                <span>
                  · <When at={entry.at} now={now} />
                </span>
              </p>
              {entry.kind === 'note' ? <p className={styles.note ?? ''}>{entry.note}</p> : null}
            </Timeline.Body>
          </Timeline.Item>
        ))}
      </Timeline>
    </section>
  )
}

function Incident({ incident }: { incident: AdminIncident }) {
  const now = useNow()
  const frozen = isFrozen(incident.state)
  return (
    <>
      <p className={styles.meta ?? ''}>
        <Label>{severityWord(incident.severity)}</Label>
        <Label variant={frozen ? 'secondary' : 'accent'}>{stateWord(incident.state)}</Label>
        <span>
          opened by {incident.createdBy === '' ? 'someone' : incident.createdBy} on{' '}
          {utcDateTime(incident.createdAt)}
        </span>
      </p>
      {incident.commander === '' ? null : <p>Commander: {incident.commander}</p>}
      {incident.reportId === '' ? null : (
        <p>
          <Link to={`/reports/${encodeURIComponent(incident.reportId)}`}>Linked report</Link>
        </p>
      )}
      <div className={styles.detail ?? ''}>
        <MoveControl incident={incident} />
        {frozen ? null : <NoteForm incident={incident} />}
        <IncidentTimeline incident={incident} now={now} />
        {frozen ? null : <DetailsForm incident={incident} />}
      </div>
    </>
  )
}

export function IncidentDetail() {
  const { id = '' } = useParams()
  const query = useAdminIncident(id)
  useDocumentTitle(query.data?.title ?? 'Incident')
  return (
    <>
      <p className={styles.back ?? ''}>
        <Link to="/incidents">Back to incidents</Link>
      </p>
      <AdminHeading>{query.data?.title ?? 'Incident'}</AdminHeading>
      {query.isPending ? (
        <p className={styles.loading ?? ''}>
          <Spinner size="small" srText={null} /> Loading the incident…
        </p>
      ) : null}
      {query.isError ? (
        <p className={styles.problem ?? ''}>
          <AlertIcon /> {failureText(query.error)}
        </p>
      ) : null}
      {query.data === undefined ? null : <Incident incident={query.data} />}
    </>
  )
}
