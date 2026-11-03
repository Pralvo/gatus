// "Report a problem": a short notice of what is kept, then the form. Nothing is
// stored in the browser: no cookies, no localStorage and no sessionStorage. The
// draft lives in this page's state and is gone when the page closes.

import { Button, FormControl, Select, Textarea, TextInput } from '@primer/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useSearchParams } from 'react-router'

import { getEndpointStatuses } from '../../api/gatus'
import type { EndpointStatus } from '../../api/types'
import { PageMessage } from '../../components/PageHead/PageMessage'
import { usePageArrival } from '../../components/PageHead/usePageArrival'
import { usePageConfig } from '../../config/context'

import styles from './problem.module.css'
import {
  contactLink,
  sendProblemReport,
  useProblemSettings,
  type ProblemDraft,
  type ProblemSettings,
  type SendOutcome,
} from './problemApi'

const minDescription = 10
const maxText = 2000

interface Errors {
  description?: string
  details?: string
}

export function checkDraft(draft: ProblemDraft): Errors {
  const errors: Errors = {}
  const description = [...draft.description.trim()].length
  if (description < minDescription) {
    errors.description = `Describe the problem in at least ${String(minDescription)} characters.`
  } else if (description > maxText) {
    errors.description = `Shorten the description to ${String(maxText)} characters or fewer.`
  }
  if ([...draft.details.trim()].length > maxText) {
    errors.details = `Shorten the details to ${String(maxText)} characters or fewer.`
  }
  return errors
}

function Notice({ settings }: { settings: ProblemSettings }) {
  const contact = contactLink(settings.contact)
  return (
    <section className={styles.notice ?? ''} aria-labelledby="problem-notice">
      <h2 id="problem-notice" className={styles.h2 ?? ''}>
        Before you send
      </h2>
      <ul className={styles.list ?? ''}>
        <li>
          <strong>What is kept:</strong> what you type, the service and page you report, the time it
          arrives, the country your connection comes from when our proxy reports it, and your
          browser and system names with the browser&rsquo;s main version number.
        </li>
        <li>
          <strong>What is not kept:</strong> your IP address, your full browser string, cookies or
          any device ID. Your address is used only in memory to limit how often one connection can
          send, and is forgotten within two hours.
        </li>
        <li>
          <strong>Why:</strong> to find and fix the problem, and to notice when many people in one
          region see the same problem.
        </li>
        <li>
          <strong>How long:</strong> {settings.retentionDays} days, then it is deleted.
        </li>
      </ul>
      <p className={styles.small ?? ''}>
        Do not include passwords or personal details you do not want kept. Read the{' '}
        <a href={settings.privacyUrl}>privacy notice</a>
        {contact === undefined ? (
          '.'
        ) : (
          <>
            , or <a href={contact}>contact us</a> to see or delete a report.
          </>
        )}
      </p>
    </section>
  )
}

function useServices() {
  return useQuery({
    queryKey: ['problem-reports', 'services'],
    queryFn: () => getEndpointStatuses(1),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

function Sent({ reference }: { reference: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <section className={styles.notice ?? ''} aria-labelledby="problem-sent">
      <h2 id="problem-sent" ref={heading} tabIndex={-1} className={styles.h2 ?? ''}>
        Thank you. Your report was sent.
      </h2>
      <p>
        Your reference is <strong className="num">{reference}</strong>. Quote it if you ask to see
        or delete this report.
      </p>
    </section>
  )
}

/** The words for a failed send, or null when there is nothing to say. */
function outcomeMessage(outcome: SendOutcome | null): string | null {
  switch (outcome?.kind) {
    case 'refused':
      return `The report was not accepted: ${outcome.message}`
    case 'rate-limited':
      return 'Too many reports came from your connection. Try again in an hour.'
    case 'failed':
      return 'The report could not be sent. Try again in a few minutes.'
    default:
      return null
  }
}

interface TextFieldProps {
  label: string
  caption: string
  value: string
  error: string | undefined
  rows: number
  required?: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
}

/** A labelled text area whose error is tied to it and read out with it. */
function TextField({
  label,
  caption,
  value,
  error,
  rows,
  required = false,
  inputRef,
  onChange,
}: TextFieldProps) {
  return (
    <FormControl required={required}>
      <FormControl.Label>{label}</FormControl.Label>
      <FormControl.Caption>{caption}</FormControl.Caption>
      <Textarea
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        rows={rows}
        block
        {...(error === undefined ? {} : { validationStatus: 'error' as const })}
      />
      {error === undefined ? null : (
        <FormControl.Validation variant="error">{error}</FormControl.Validation>
      )}
    </FormControl>
  )
}

/** The services to choose from, with the one the link named even if it is not listed. */
function serviceChoices(statuses: EndpointStatus[] | undefined, chosen: string) {
  const listed = (statuses ?? []).map((s) => ({
    key: s.key,
    label: s.group ? `${s.group} / ${s.name ?? s.key}` : (s.name ?? s.key),
  }))
  if (chosen !== '' && !listed.some((s) => s.key === chosen)) {
    listed.unshift({ key: chosen, label: chosen })
  }
  return listed
}

function initialDraft(params: URLSearchParams): ProblemDraft {
  const from = params.get('from') ?? ''
  return {
    description: '',
    details: '',
    service: params.get('service') ?? '',
    page: from.startsWith('/') && !from.startsWith('//') ? from : '',
    website: '',
  }
}

function ProblemForm({ settings }: { settings: ProblemSettings }) {
  const [params] = useSearchParams()
  const services = useServices()
  const [draft, setDraft] = useState<ProblemDraft>(() => initialDraft(params))
  const [errors, setErrors] = useState<Errors>({})
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)
  const description = useRef<HTMLTextAreaElement>(null)
  const details = useRef<HTMLTextAreaElement>(null)

  if (outcome?.kind === 'sent') {
    return <Sent reference={outcome.reference} />
  }
  const set = (field: keyof ProblemDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const found = checkDraft(draft)
    setErrors(found)
    if (found.description !== undefined || found.details !== undefined) {
      ;(found.description === undefined ? details : description).current?.focus()
      return
    }
    setSending(true)
    setOutcome(await sendProblemReport(draft))
    setSending(false)
  }
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className={styles.form ?? ''}>
      <Notice settings={settings} />
      <FormControl>
        <FormControl.Label>Service (optional)</FormControl.Label>
        <Select
          value={draft.service}
          onChange={(e) => {
            set('service')(e.target.value)
          }}
          block
        >
          <Select.Option value="">Not sure, or the whole site</Select.Option>
          {serviceChoices(services.data, draft.service).map((s) => (
            <Select.Option key={s.key} value={s.key}>
              {s.label}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
      <TextField
        label="What went wrong?"
        caption="At least 10 and at most 2000 characters."
        value={draft.description}
        error={errors.description}
        rows={5}
        required
        inputRef={description}
        onChange={set('description')}
      />
      <TextField
        label="Anything else that helps (optional)"
        caption="For example, what you tried, or what you saw on screen."
        value={draft.details}
        error={errors.details}
        rows={3}
        inputRef={details}
        onChange={set('details')}
      />
      <div className={styles.trap ?? ''} aria-hidden="true">
        <label htmlFor="problem-website">Leave this empty</label>
        <TextInput
          id="problem-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={draft.website}
          onChange={(e) => {
            set('website')(e.target.value)
          }}
        />
      </div>
      <div role="alert" className={styles.alert ?? ''}>
        {outcomeMessage(outcome)}
      </div>
      <Button type="submit" variant="primary" loading={sending}>
        Send report
      </Button>
    </form>
  )
}

/** The page at /report-a-problem. Without the plugin it says the form is off. */
export function ProblemPage() {
  const { header } = usePageConfig()
  const settings = useProblemSettings()
  const headingRef = usePageArrival(`Report a problem · ${header}`, !settings.isPending)
  if (settings.isPending) {
    return <p aria-busy="true">Loading…</p>
  }
  if (settings.data == null) {
    return (
      <PageMessage
        headingRef={headingRef}
        title="Reporting a problem is not available here"
        message="This status page does not take problem reports."
      />
    )
  }
  return (
    <>
      <h1 className={styles.h1 ?? ''} tabIndex={-1} ref={headingRef}>
        Report a problem
      </h1>
      <p>Tell us what is not working on this status page or the services it shows.</p>
      <ProblemForm settings={settings.data} />
    </>
  )
}
