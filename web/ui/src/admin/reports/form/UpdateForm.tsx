// "Post an update": a stage and a message. The update sets the report's stage.

import { Button, FormControl, Select, Textarea } from '@primer/react'
import { useState, type FormEvent } from 'react'

import { reportStages, type ReportStage } from '../../../api/plugins/types'
import { stageWord } from '../../../domain/notices/reports'
import type { AdminReport } from '../../api/types'
import { storeReport, useAdminAction } from '../../data/queries'

import styles from './form.module.css'

const messageLimit = 5000

export function UpdateForm({ report }: { report: AdminReport }) {
  const [stage, setStage] = useState<ReportStage>(report.stage)
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const post = useAdminAction(
    (client, input: { stage: ReportStage; message: string }) =>
      client.addReportUpdate(report.id, input.stage, input.message),
    (changed, queryClient) => {
      storeReport(queryClient, changed)
      setMessage('')
      return { message: 'Update posted.' }
    },
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (message.trim() === '') {
      setProblem('Write a message first.')
      return
    }
    setProblem(null)
    post.mutate({ stage, message })
  }

  return (
    <form className={styles.fields ?? ''} onSubmit={submit} noValidate>
      <FormControl>
        <FormControl.Label>Stage</FormControl.Label>
        <Select
          value={stage}
          onChange={(event) => {
            setStage(reportStages.find((value) => value === event.target.value) ?? stage)
          }}
        >
          {reportStages.map((value) => (
            <Select.Option key={value} value={value}>
              {stageWord(value)}
            </Select.Option>
          ))}
        </Select>
      </FormControl>
      <FormControl required>
        <FormControl.Label>Message</FormControl.Label>
        <Textarea
          block
          rows={4}
          maxLength={messageLimit}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
          }}
        />
        <FormControl.Caption>
          {String(messageLimit - message.length)} characters left
        </FormControl.Caption>
        {problem === null ? null : (
          <FormControl.Validation variant="error">{problem}</FormControl.Validation>
        )}
      </FormControl>
      <div>
        <Button type="submit" loading={post.isPending}>
          Post update
        </Button>
      </div>
    </form>
  )
}
