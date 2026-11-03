// Publication: a draft is published, and a published report returned to draft,
// only after a confirming Dialog. Unsaved choices are saved first, so visitors
// read what the preview showed.

import { Button, Dialog } from '@primer/react'
import { useRef, useState } from 'react'

import { isEmptyChange } from '../../../domain/admin/affected'
import { utcDateTime } from '../../../domain/time/format'
import type { AdminReport, ReportChange } from '../../api/types'
import { storeReport, useAdminAction } from '../../data/queries'
import styles from '../reports.module.css'

export interface PublishControlProps {
  report: AdminReport
  /** What the editor holds that is not saved yet. */
  pending: ReportChange
  onSaved: () => void
}

export function PublishControl({ report, pending, onSaved }: PublishControlProps) {
  const opener = useRef<HTMLButtonElement>(null)
  const [asking, setAsking] = useState(false)
  const published = report.publishedAt !== null
  const action = useAdminAction(
    async (client, publish: boolean) => {
      if (publish && !isEmptyChange(pending)) {
        await client.changeReport(report.id, pending)
      }
      return client.setReportPublished(report.id, publish)
    },
    (changed, queryClient, publish) => {
      storeReport(queryClient, changed)
      onSaved()
      return { message: publish ? 'Published.' : 'Returned to draft.' }
    },
  )
  const close = () => {
    setAsking(false)
  }
  const confirm = () => {
    setAsking(false)
    action.mutate(!published)
  }

  return (
    <section className={styles.panel ?? ''} aria-label="Publication">
      {published ? (
        <p>
          <strong>Published</strong> on {utcDateTime(report.publishedAt ?? 0)}.{' '}
          <a href={`/reports/${encodeURIComponent(report.id)}`}>View the public page</a>
        </p>
      ) : (
        <p>
          <strong>Draft.</strong> Only people with a token can see it.
        </p>
      )}
      <Button
        ref={opener}
        variant={published ? 'default' : 'primary'}
        loading={action.isPending}
        onClick={() => {
          setAsking(true)
        }}
      >
        {published ? 'Return to draft…' : 'Publish…'}
      </Button>
      {asking ? (
        <Dialog
          title={published ? 'Return this report to draft?' : 'Publish this report?'}
          onClose={close}
          returnFocusRef={opener}
          footerButtons={[
            { content: 'Cancel', onClick: close },
            {
              content: published ? 'Return to draft' : 'Publish',
              buttonType: published ? 'danger' : 'primary',
              onClick: confirm,
            },
          ]}
        >
          {published ? (
            <p className={styles.dialogText ?? ''}>
              It will be taken off the status page within about 30 seconds. People may already have
              seen it, and feed readers may keep their copy.
            </p>
          ) : (
            <p className={styles.dialogText ?? ''}>
              It will appear on the status page and in the feeds within about 30 seconds. Visitors
              will read the wording shown in the preview. You can return it to draft later, but
              people may already have seen it.
              {isEmptyChange(pending)
                ? null
                : ' Your unsaved changes to the title and affected services are saved first.'}
            </p>
          )}
        </Dialog>
      ) : null}
    </section>
  )
}
