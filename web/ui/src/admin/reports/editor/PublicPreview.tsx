// "What visitors will see after publishing": the status page's H1, detail line
// and each affected service's word, from headline() with the current choices.

import { Label, Spinner } from '@primer/react'
import { useId } from 'react'

import { previewHeadline, type DraftReport } from '../../../domain/admin/preview'
import type { Tone } from '../../../domain/status/service'
import type { PublicPicture } from '../../data/public'
import styles from '../reports.module.css'

const labelVariants = {
  success: 'success',
  attention: 'attention',
  severe: 'severe',
  danger: 'danger',
  neutral: 'secondary',
} as const satisfies Record<Tone, string>

export interface PublicPreviewProps {
  draft: DraftReport
  picture: PublicPicture
}

function PreviewBody({ draft, picture }: PublicPreviewProps) {
  if (picture.failed) {
    return <p>The service checks could not be loaded, so the preview cannot be shown.</p>
  }
  if (!picture.loaded) {
    return (
      <p className={styles.loading ?? ''}>
        <Spinner size="small" srText={null} /> Loading the service checks…
      </p>
    )
  }
  const preview = previewHeadline({
    loaded: true,
    services: picture.services,
    reports: picture.reports,
    windows: picture.windows,
    draft,
    now: picture.now,
  })
  const { headline } = preview
  return (
    <>
      <div className={styles.answer ?? ''} data-tone={headline.tone}>
        <p className={styles.answerTitle ?? ''}>{headline.title}</p>
        {headline.detail === null ? null : (
          <p className={styles.answerDetail ?? ''}>{headline.detail}</p>
        )}
      </div>
      {preview.affected.length === 0 ? (
        <p className={styles.caption ?? ''}>No service is marked as affected.</p>
      ) : (
        <ul className={styles.words ?? ''} aria-label="Affected services as visitors will see them">
          {preview.affected.map((entry) => (
            <li key={entry.key}>
              <span>{entry.name}</span>
              <Label variant={labelVariants[entry.tone]}>{entry.word}</Label>
            </li>
          ))}
        </ul>
      )}
      {preview.counts ? null : (
        <p className={styles.caption ?? ''}>
          This report is resolved, so it does not change the headline.
        </p>
      )}
    </>
  )
}

export function PublicPreview(props: PublicPreviewProps) {
  const headingId = useId()
  return (
    <aside className={styles.preview ?? ''} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.h2 ?? ''}>
        What visitors will see after publishing
      </h2>
      <div aria-live="polite">
        <PreviewBody {...props} />
      </div>
      <p className={styles.caption ?? ''}>
        The status page also lists the report under what is happening and in the record.
      </p>
    </aside>
  )
}
