// The report editor (design spec section 4.6): publication, "From the checks",
// the title and affected services, posting updates, and the public preview
// beside them. Choices not yet saved live here and drive the preview.

import { AlertIcon, CheckIcon, CommentIcon } from '@primer/octicons-react'
import { Button, FormControl, Label, Spinner, TextInput, Timeline } from '@primer/react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { useNow } from '../../../data/cycle'
import { changeBetween, isEmptyChange, type ReportChoices } from '../../../domain/admin/affected'
import { withImpact } from '../../../domain/admin/affected'
import { checkSuggestions, type Suggestion } from '../../../domain/admin/preview'
import { stageWord } from '../../../domain/notices/reports'
import { failure } from '../../api/client'
import type { AdminReport } from '../../api/types'
import { usePublicPicture, type PublicPicture } from '../../data/public'
import { failureText, storeReport, useAdminAction, useAdminReport } from '../../data/queries'
import { useSay } from '../../shell/notice'
import { AdminHeading, useDocumentTitle, When } from '../../shell/page'
import { ImpactPicker } from '../form/ImpactPicker'
import { UpdateForm } from '../form/UpdateForm'
import styles from '../reports.module.css'

import { FromTheChecks } from './FromTheChecks'
import { PublicPreview } from './PublicPreview'
import { PublishControl } from './PublishControl'

const pickerPrefix = 'edit-impact'

function Updates({ report, now }: { report: AdminReport; now: number }) {
  return (
    <Timeline>
      {[...report.updates].reverse().map((update) => (
        <Timeline.Item key={`${String(update.seq)}-${String(update.at)}`}>
          <Timeline.Badge>
            {update.stage === 'resolved' ? <CheckIcon /> : <CommentIcon />}
          </Timeline.Badge>
          <Timeline.Body>
            <p className={styles.meta ?? ''}>
              <Label>{stageWord(update.stage)}</Label> <When at={update.at} now={now} />
              {update.actor === '' ? null : ` · ${update.actor}`}
            </p>
            <p className={styles.message ?? ''}>{update.message}</p>
          </Timeline.Body>
        </Timeline.Item>
      ))}
    </Timeline>
  )
}

function Editor({ report, picture }: { report: AdminReport; picture: PublicPicture }) {
  const now = useNow()
  const say = useSay()
  const saved: ReportChoices = { title: report.title, endpoints: report.endpoints }
  const [edits, setEdits] = useState<ReportChoices | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const current = edits ?? saved
  const pending = changeBetween(saved, current)
  const save = useAdminAction(
    (client, change: typeof pending) => {
      if (isEmptyChange(change)) {
        return Promise.reject(failure('unchanged'))
      }
      return client.changeReport(report.id, change)
    },
    (changed, queryClient) => {
      storeReport(queryClient, changed)
      setEdits(null)
      return { message: 'Saved.' }
    },
  )

  useEffect(() => {
    if (focusKey !== null) {
      document.getElementById(`${pickerPrefix}-${focusKey}`)?.focus()
      setFocusKey(null)
    }
  }, [focusKey])

  const add = (suggestion: Suggestion) => {
    setEdits({ ...current, endpoints: withImpact(current.endpoints, suggestion.key, 'partial') })
    setFocusKey(suggestion.key)
    say(`${suggestion.name} set to Partial outage. Check the preview, then save.`)
  }

  const draft = {
    ...report,
    title: current.title.trim() || report.title,
    endpoints: current.endpoints,
  }
  return (
    <div className={styles.editor ?? ''}>
      <div className={styles.column ?? ''}>
        <FromTheChecks
          suggestions={checkSuggestions(picture.services, current.endpoints, picture.now)}
          onAdd={add}
        />
        <PublishControl
          report={report}
          pending={pending}
          onSaved={() => {
            setEdits(null)
          }}
        />
        <section aria-labelledby="edit-heading">
          <h2 id="edit-heading" className={styles.h2 ?? ''}>
            Title and affected services
          </h2>
          <p className={styles.caption ?? ''}>
            The preview shows the headline visitors will read with these choices.
          </p>
          <form
            className={styles.fields ?? ''}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate(pending)
            }}
          >
            <FormControl required>
              <FormControl.Label>Title</FormControl.Label>
              <TextInput
                block
                maxLength={200}
                value={current.title}
                onChange={(event) => {
                  setEdits({ ...current, title: event.target.value })
                }}
              />
            </FormControl>
            <ImpactPicker
              idPrefix={pickerPrefix}
              services={picture.services}
              value={current.endpoints}
              onChange={(endpoints) => {
                setEdits({ ...current, endpoints })
              }}
            />
            <div>
              <Button type="submit" loading={save.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </section>
        <section aria-labelledby="update-heading">
          <h2 id="update-heading" className={styles.h2 ?? ''}>
            Post an update
          </h2>
          <UpdateForm report={report} />
        </section>
        <section aria-labelledby="updates-heading">
          <h2 id="updates-heading" className={styles.h2 ?? ''}>
            Updates, newest first
          </h2>
          <Updates report={report} now={now} />
        </section>
      </div>
      <PublicPreview draft={draft} picture={picture} />
    </div>
  )
}

export function ReportEditor() {
  const { id = '' } = useParams()
  const query = useAdminReport(id)
  const picture = usePublicPicture()
  useDocumentTitle(query.data?.title ?? 'Report')
  return (
    <>
      <p className={styles.back ?? ''}>
        <Link to="/">Back to reports</Link>
      </p>
      <AdminHeading>{query.data?.title ?? 'Report'}</AdminHeading>
      {query.isPending ? (
        <p className={styles.loading ?? ''}>
          <Spinner size="small" srText={null} /> Loading the report…
        </p>
      ) : null}
      {query.isError ? (
        <p className={styles.problem ?? ''}>
          <AlertIcon /> {failureText(query.error)}
        </p>
      ) : null}
      {query.data === undefined ? null : (
        <>
          <p className={styles.meta ?? ''}>
            <Label>{stageWord(query.data.stage)}</Label>{' '}
            {query.data.publishedAt === null ? 'Draft' : 'Published'}
          </p>
          <Editor report={query.data} picture={picture} />
        </>
      )}
    </>
  )
}
