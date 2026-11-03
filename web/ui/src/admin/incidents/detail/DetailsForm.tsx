// "Details": title, severity, commander, linked report and postmortem. Only
// changed fields are sent; an emptied commander or report link clears it.

import { Button, FormControl, Select, Textarea, TextInput } from '@primer/react'
import { useState } from 'react'

import {
  incidentChangeBetween,
  severityWord,
  type IncidentChoices,
} from '../../../domain/admin/moves'
import { failure } from '../../api/client'
import { severities, type AdminIncident, type IncidentChange } from '../../api/types'
import { storeIncident, useAdminAction } from '../../data/queries'
import styles from '../incidents.module.css'

function isEmpty(change: IncidentChange): boolean {
  return Object.keys(change).length === 0
}

export function DetailsForm({ incident }: { incident: AdminIncident }) {
  const saved: IncidentChoices = {
    title: incident.title,
    severity: incident.severity,
    commander: incident.commander,
    reportId: incident.reportId,
    postmortem: incident.postmortem,
  }
  const [edits, setEdits] = useState<IncidentChoices | null>(null)
  const current = edits ?? saved
  const set = (field: Partial<IncidentChoices>) => {
    setEdits({ ...current, ...field })
  }
  const save = useAdminAction(
    (client, change: IncidentChange) =>
      isEmpty(change)
        ? Promise.reject(failure('unchanged'))
        : client.changeIncident(incident.id, change),
    (changed, queryClient) => {
      storeIncident(queryClient, changed)
      setEdits(null)
      return { message: 'Saved.' }
    },
  )

  return (
    <section aria-labelledby="details-heading">
      <h2 id="details-heading" className={styles.h2 ?? ''}>
        Details
      </h2>
      <form
        className={styles.fields ?? ''}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate(incidentChangeBetween(saved, current))
        }}
      >
        <FormControl required>
          <FormControl.Label>Title</FormControl.Label>
          <TextInput
            block
            maxLength={200}
            value={current.title}
            onChange={(event) => {
              set({ title: event.target.value })
            }}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Severity</FormControl.Label>
          <Select
            value={current.severity}
            onChange={(event) => {
              const severity = severities.find((value) => value === event.target.value)
              set({ severity: severity ?? current.severity })
            }}
          >
            {severities.map((value) => (
              <Select.Option key={value} value={value}>
                {severityWord(value)}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>Commander</FormControl.Label>
          <TextInput
            block
            maxLength={100}
            value={current.commander}
            onChange={(event) => {
              set({ commander: event.target.value })
            }}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Linked report ID</FormControl.Label>
          <FormControl.Caption>Leave it empty to remove the link.</FormControl.Caption>
          <TextInput
            block
            maxLength={32}
            spellCheck={false}
            value={current.reportId}
            onChange={(event) => {
              set({ reportId: event.target.value })
            }}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Postmortem, in Markdown</FormControl.Label>
          <Textarea
            block
            rows={8}
            value={current.postmortem}
            onChange={(event) => {
              set({ postmortem: event.target.value })
            }}
          />
        </FormControl>
        <div>
          <Button type="submit" loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </section>
  )
}
