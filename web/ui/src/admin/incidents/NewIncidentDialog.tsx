// "New incident": title, severity and an optional commander. It opens in the
// "open" state.

import { Banner, Dialog, FormControl, Select, TextInput } from '@primer/react'
import { useId, useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'

import { severityWord } from '../../domain/admin/moves'
import { severities, type Severity } from '../api/types'
import { failureText, storeIncident, useAdminAction } from '../data/queries'

import styles from './incidents.module.css'

export interface NewIncidentDialogProps {
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

export function NewIncidentDialog({ onClose, returnFocusRef }: NewIncidentDialogProps) {
  const formId = useId()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<Severity>('major')
  const [commander, setCommander] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const open = useAdminAction(
    (client, input: { title: string; commander: string }) =>
      client.createIncident({ ...input, severity }),
    (incident, queryClient) => {
      storeIncident(queryClient, incident)
      const path = `/incidents/${encodeURIComponent(incident.id)}`
      void navigate(path)
      return { message: 'Incident opened.', path }
    },
    { sayFailures: false },
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim() === '') {
      setProblem('Enter a title.')
      return
    }
    setProblem(null)
    open.mutate({ title: title.trim(), commander: commander.trim() })
  }

  return (
    <Dialog
      title="New incident"
      subtitle="Incidents are internal and never shown to the public."
      width="large"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        {
          content: 'Open incident',
          buttonType: 'primary',
          type: 'submit',
          form: formId,
          loading: open.isPending,
        },
      ]}
    >
      <form id={formId} className={styles.fields ?? ''} onSubmit={submit} noValidate>
        {open.isError ? (
          <Banner
            title="Not opened"
            hideTitle
            variant="critical"
            description={failureText(open.error)}
          />
        ) : null}
        <FormControl required>
          <FormControl.Label>Title</FormControl.Label>
          <TextInput
            block
            maxLength={200}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
          />
          {problem === null ? null : (
            <FormControl.Validation variant="error">{problem}</FormControl.Validation>
          )}
        </FormControl>
        <FormControl>
          <FormControl.Label>Severity</FormControl.Label>
          <Select
            value={severity}
            onChange={(event) => {
              setSeverity(severities.find((value) => value === event.target.value) ?? severity)
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
          <FormControl.Caption>Optional: who is running the response.</FormControl.Caption>
          <TextInput
            block
            maxLength={100}
            value={commander}
            onChange={(event) => {
              setCommander(event.target.value)
            }}
          />
        </FormControl>
      </form>
    </Dialog>
  )
}
