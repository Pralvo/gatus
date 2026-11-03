// The incidents list, newest change first, with "New incident".

import { Banner, Button, Label, Spinner } from '@primer/react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { useNow } from '../../data/cycle'
import { severityWord, stateWord } from '../../domain/admin/moves'
import type { AdminIncident } from '../api/types'
import { failureText, useAdminIncidents } from '../data/queries'
import { AdminHeading, useDocumentTitle, When } from '../shell/page'
import shell from '../shell/shell.module.css'

import styles from './incidents.module.css'
import { NewIncidentDialog } from './NewIncidentDialog'

function IncidentTable({ incidents, now }: { incidents: AdminIncident[]; now: number }) {
  return (
    <table className={shell.table ?? ''}>
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Severity</th>
          <th scope="col">State</th>
          <th scope="col">Opened</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((incident) => (
          <tr key={incident.id}>
            <td>
              <Link to={`/incidents/${encodeURIComponent(incident.id)}`}>{incident.title}</Link>
            </td>
            <td data-label="Severity">{severityWord(incident.severity)}</td>
            <td data-label="State">
              <Label>{stateWord(incident.state)}</Label>
            </td>
            <td data-label="Opened">
              <When at={incident.createdAt} now={now} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function IncidentsPage() {
  useDocumentTitle('Incidents')
  const incidents = useAdminIncidents()
  const now = useNow()
  const [creating, setCreating] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const list = incidents.data ?? []

  return (
    <>
      <div className={styles.titleRow ?? ''}>
        <AdminHeading>Incidents</AdminHeading>
        <Button
          ref={opener}
          variant="primary"
          onClick={() => {
            setCreating(true)
          }}
        >
          New incident
        </Button>
      </div>
      <p className={styles.caption ?? ''}>Incidents are internal and never shown to the public.</p>
      {incidents.isPending ? (
        <p className={styles.loading ?? ''}>
          <Spinner size="small" srText={null} /> Loading incidents…
        </p>
      ) : null}
      {incidents.isError ? (
        <Banner
          title="Incidents could not be loaded"
          hideTitle
          variant="critical"
          description={failureText(incidents.error)}
          primaryAction={
            <Banner.PrimaryAction
              onClick={() => {
                void incidents.refetch()
              }}
            >
              Try again
            </Banner.PrimaryAction>
          }
        />
      ) : null}
      {incidents.isSuccess && list.length === 0 ? <p>No incidents.</p> : null}
      {list.length > 0 ? <IncidentTable incidents={list} now={now} /> : null}
      {creating ? (
        <NewIncidentDialog
          onClose={() => {
            setCreating(false)
          }}
          returnFocusRef={opener}
        />
      ) : null}
    </>
  )
}
