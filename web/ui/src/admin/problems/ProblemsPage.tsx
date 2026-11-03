// Problem reports from visitors: the last hour by country and service, a
// search by reference for a visitor's request to see or delete theirs, and
// the list, newest first, each with "Delete".

import {
  Banner,
  Button,
  FormControl,
  Spinner,
  TextInput,
  useConfirm,
  VisuallyHidden,
} from '@primer/react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { useNow } from '../../data/cycle'
import { failureText, useAdminAction } from '../data/queries'
import { useAdminClient } from '../session/Session'
import { AdminHeading, useDocumentTitle, When } from '../shell/page'
import shell from '../shell/shell.module.css'

import { pageSize, type ProblemFilter, type ProblemReport, type Tally } from './problemCalls'
import styles from './problems.module.css'

const keys = {
  all: ['admin', 'problems'] as const,
  list: (filter: ProblemFilter) => ['admin', 'problems', 'list', filter] as const,
  summary: ['admin', 'problems', 'summary'] as const,
  one: (reference: string) => ['admin', 'problems', 'one', reference] as const,
}

const once = { retry: false, refetchOnWindowFocus: false } as const

function forget(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: keys.all })
}

function Tallies({
  title,
  tallies,
  unknown,
}: {
  title: string
  tallies: Tally[]
  unknown: string
}) {
  return (
    <div>
      <h3 className={styles.h3 ?? ''}>{title}</h3>
      {tallies.length === 0 ? (
        <p className={shell.muted ?? ''}>None.</p>
      ) : (
        <ul className={styles.tallies ?? ''}>
          {tallies.map((tally) => (
            <li key={tally.key}>
              {tally.key === '' ? unknown : tally.key}: <span className="num">{tally.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LastHour() {
  const client = useAdminClient()
  const summary = useQuery({
    queryKey: keys.summary,
    queryFn: () => client.problemSummary(),
    ...once,
  })
  return (
    <section aria-labelledby="problems-hour" className={styles.box ?? ''}>
      <h2 id="problems-hour" className={styles.h2 ?? ''}>
        Last hour: {summary.data === undefined ? '…' : `${String(summary.data.total)} reports`}
      </h2>
      {summary.isError ? <p>{failureText(summary.error)}</p> : null}
      {summary.data === undefined ? null : (
        <div className={styles.columns ?? ''}>
          <Tallies title="By country" tallies={summary.data.countries} unknown="Unknown" />
          <Tallies title="By service" tallies={summary.data.services} unknown="None chosen" />
        </div>
      )}
    </section>
  )
}

function ProblemRow({ report, now }: { report: ProblemReport; now: number }) {
  const confirm = useConfirm()
  const remove = useAdminAction(
    (client, reference: string) => client.deleteProblem(reference),
    (reference, queryClient) => {
      forget(queryClient)
      return { message: `Report ${reference} deleted.` }
    },
  )
  const ask = async () => {
    const sure = await confirm({
      title: `Delete report ${report.reference}?`,
      content: 'It is removed from the database for good. Use this for a request to delete it.',
      confirmButtonContent: 'Delete',
      confirmButtonType: 'danger',
    })
    if (sure) {
      remove.mutate(report.reference)
    }
  }
  const agent = [
    report.browser,
    report.browserMajor > 0 ? String(report.browserMajor) : '',
    report.os,
  ]
  return (
    <tr>
      <td data-label="Received">
        <When at={report.receivedAt} now={now} />
        <div className={`num ${shell.muted ?? ''}`}>{report.reference}</div>
      </td>
      <td data-label="Report">
        <p className={styles.text ?? ''}>{report.description}</p>
        {report.details === '' ? null : (
          <p className={`${styles.text ?? ''} ${shell.muted ?? ''}`}>{report.details}</p>
        )}
      </td>
      <td data-label="Service">{report.service || '—'}</td>
      <td data-label="Country">{report.country || 'Unknown'}</td>
      <td data-label="Browser">{agent.filter(Boolean).join(' ') || 'Unknown'}</td>
      <td>
        <Button
          size="small"
          variant="danger"
          loading={remove.isPending}
          aria-label={`Delete ${report.reference}`}
          onClick={() => void ask()}
        >
          Delete
        </Button>
      </td>
    </tr>
  )
}

function ProblemTable({ reports, now }: { reports: ProblemReport[]; now: number }) {
  return (
    <table className={shell.table ?? ''}>
      <thead>
        <tr>
          <th scope="col">Received</th>
          <th scope="col">Report</th>
          <th scope="col">Service</th>
          <th scope="col">Country</th>
          <th scope="col">Browser</th>
          <th scope="col">
            <VisuallyHidden>Actions</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => (
          <ProblemRow key={report.reference} report={report} now={now} />
        ))}
      </tbody>
    </table>
  )
}

/** Finds one report by its reference, for a visitor who asks to see or delete it. */
function FindByReference({ now }: { now: number }) {
  const client = useAdminClient()
  const [draft, setDraft] = useState('')
  const [reference, setReference] = useState('')
  const found = useQuery({
    queryKey: keys.one(reference),
    queryFn: () => client.getProblem(reference),
    enabled: reference !== '',
    ...once,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setReference(draft.trim())
  }
  return (
    <>
      <form className={styles.row ?? ''} onSubmit={submit} aria-label="Find a report">
        <FormControl>
          <FormControl.Label>Reference</FormControl.Label>
          <TextInput
            placeholder="PR-…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
            }}
          />
        </FormControl>
        <Button type="submit">Find</Button>
      </form>
      <div role="status" aria-live="polite" aria-label="Search result">
        {reference !== '' && found.isError ? <p>{failureText(found.error)}</p> : null}
        {found.data === undefined ? null : <ProblemTable reports={[found.data]} now={now} />}
      </div>
    </>
  )
}

interface Filters {
  service: string
  country: string
}

function FilterForm({ onApply }: { onApply: (filters: Filters) => void }) {
  const [service, setService] = useState('')
  const [country, setCountry] = useState('')
  return (
    <form
      className={styles.row ?? ''}
      aria-label="Filter reports"
      onSubmit={(event) => {
        event.preventDefault()
        onApply({ service: service.trim(), country: country.trim().toUpperCase() })
      }}
    >
      <FormControl>
        <FormControl.Label>Service key</FormControl.Label>
        <TextInput
          value={service}
          onChange={(e) => {
            setService(e.target.value)
          }}
        />
      </FormControl>
      <FormControl>
        <FormControl.Label>Country code</FormControl.Label>
        <TextInput
          maxLength={2}
          value={country}
          onChange={(e) => {
            setCountry(e.target.value)
          }}
        />
      </FormControl>
      <Button type="submit">Filter</Button>
    </form>
  )
}

function ReportList({ now }: { now: number }) {
  const client = useAdminClient()
  const [filters, setFilters] = useState<Filters>({ service: '', country: '' })
  const [offset, setOffset] = useState(0)
  const wanted: ProblemFilter = { ...filters, offset }
  const list = useQuery({
    queryKey: keys.list(wanted),
    queryFn: () => client.listProblems(wanted),
    ...once,
  })
  const reports = list.data?.reports ?? []
  return (
    <>
      <FilterForm
        onApply={(next) => {
          setOffset(0)
          setFilters(next)
        }}
      />
      {list.isPending ? <Spinner size="small" srText="Loading reports" /> : null}
      {list.isError ? (
        <Banner
          title="Reports could not be loaded"
          hideTitle
          variant="critical"
          description={failureText(list.error)}
        />
      ) : null}
      {list.isSuccess && reports.length === 0 ? <p>No reports.</p> : null}
      {reports.length > 0 ? <ProblemTable reports={reports} now={now} /> : null}
      <div className={styles.row ?? ''}>
        {offset > 0 ? (
          <Button
            onClick={() => {
              setOffset(Math.max(0, offset - pageSize))
            }}
          >
            Newer
          </Button>
        ) : null}
        {list.data?.more === true ? (
          <Button
            onClick={() => {
              setOffset(offset + pageSize)
            }}
          >
            Older
          </Button>
        ) : null}
      </div>
    </>
  )
}

export function ProblemsPage() {
  useDocumentTitle('Problem reports')
  const now = useNow()
  return (
    <>
      <AdminHeading>Problem reports</AdminHeading>
      <p className={shell.muted ?? ''}>What visitors sent from the “Report a problem” form.</p>
      <LastHour />
      <FindByReference now={now} />
      <ReportList now={now} />
    </>
  )
}
