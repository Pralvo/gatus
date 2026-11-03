// "Add a note" to an incident's timeline.

import { Button, FormControl, Textarea } from '@primer/react'
import { useState, type FormEvent } from 'react'

import type { AdminIncident } from '../../api/types'
import { storeIncident, useAdminAction } from '../../data/queries'
import styles from '../incidents.module.css'

export function NoteForm({ incident }: { incident: AdminIncident }) {
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const add = useAdminAction(
    (client, text: string) => client.addIncidentNote(incident.id, text),
    (changed, queryClient) => {
      storeIncident(queryClient, changed)
      setNote('')
      return { message: 'Note added.' }
    },
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (note.trim() === '') {
      setProblem('Write a note first.')
      return
    }
    setProblem(null)
    add.mutate(note)
  }

  return (
    <section aria-labelledby="note-heading">
      <h2 id="note-heading" className={styles.h2 ?? ''}>
        Add a note
      </h2>
      <form className={styles.fields ?? ''} onSubmit={submit} noValidate>
        <FormControl required>
          <FormControl.Label>Note</FormControl.Label>
          <Textarea
            block
            rows={3}
            maxLength={5000}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
            }}
          />
          {problem === null ? null : (
            <FormControl.Validation variant="error">{problem}</FormControl.Validation>
          )}
        </FormControl>
        <div>
          <Button type="submit" loading={add.isPending}>
            Add note
          </Button>
        </div>
      </form>
    </section>
  )
}
