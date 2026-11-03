// The reports list: every report, or only drafts or published ones, newest
// change first, with "New report".

import { Banner, Button, Label, SegmentedControl, Spinner } from '@primer/react'
import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { useNow } from '../../data/cycle'
import { stageWord } from '../../domain/notices/reports'
import type { AdminReport } from '../api/types'
import { failureText, useAdminReports } from '../data/queries'
import { AdminHeading, useDocumentTitle, When } from '../shell/page'
import shell from '../shell/shell.module.css'

import { NewReportDialog } from './form/NewReportDialog'
import styles from './reports.module.css'

const views = [
  { value: 'all', label: 'All', empty: 'No reports yet.' },
  { value: 'drafts', label: 'Drafts', empty: 'No drafts.' },
  { value: 'published', label: 'Published', empty: 'No published reports.' },
] as const

type View = (typeof views)[number]['value']

function shown(reports: AdminReport[], view: View): AdminReport[] {
  if (view === 'all') {
    return reports
  }
  return reports.filter((report) => (report.publishedAt === null) === (view === 'drafts'))
}

function ReportTable({ reports, now }: { reports: AdminReport[]; now: number }) {
  return (
    <table className={shell.table ?? ''}>
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Stage</th>
          <th scope="col">Visibility</th>
          <th scope="col">Updated</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => (
          <tr key={report.id}>
            <td>
              <Link to={`/reports/${encodeURIComponent(report.id)}`}>{report.title}</Link>
            </td>
            <td data-label="Stage">
              <Label variant={report.stage === 'resolved' ? 'success' : 'attention'}>
                {stageWord(report.stage)}
              </Label>
            </td>
            <td data-label="Visibility">{report.publishedAt === null ? 'Draft' : 'Published'}</td>
            <td data-label="Updated">
              <When at={report.updatedAt} now={now} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ReportsPage() {
  useDocumentTitle('Reports')
  const reports = useAdminReports()
  const now = useNow()
  const [view, setView] = useState<View>('all')
  const [creating, setCreating] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const current = views.find((candidate) => candidate.value === view) ?? views[0]
  const list = shown(reports.data ?? [], view)

  return (
    <>
      <div className={styles.titleRow ?? ''}>
        <AdminHeading>Reports</AdminHeading>
        <Button
          ref={opener}
          variant="primary"
          onClick={() => {
            setCreating(true)
          }}
        >
          New report
        </Button>
      </div>
      <p className={styles.caption ?? ''}>
        Reports are public once published. Drafts are seen only here.
      </p>
      <SegmentedControl
        aria-label="Show reports"
        onChange={(index) => {
          setView(views.at(index)?.value ?? 'all')
        }}
      >
        {views.map((candidate) => (
          <SegmentedControl.Button key={candidate.value} selected={candidate.value === view}>
            {candidate.label}
          </SegmentedControl.Button>
        ))}
      </SegmentedControl>
      {reports.isPending ? (
        <p className={styles.loading ?? ''}>
          <Spinner size="small" srText={null} /> Loading reports…
        </p>
      ) : null}
      {reports.isError ? (
        <Banner
          title="Reports could not be loaded"
          hideTitle
          variant="critical"
          description={failureText(reports.error)}
          primaryAction={
            <Banner.PrimaryAction
              onClick={() => {
                void reports.refetch()
              }}
            >
              Try again
            </Banner.PrimaryAction>
          }
        />
      ) : null}
      {reports.isSuccess && list.length === 0 ? <p>{current.empty}</p> : null}
      {list.length > 0 ? <ReportTable reports={list} now={now} /> : null}
      {creating ? (
        <NewReportDialog
          onClose={() => {
            setCreating(false)
          }}
          returnFocusRef={opener}
        />
      ) : null}
    </>
  )
}
