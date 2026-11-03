// "New report": title, stage, first message and affected services. It always
// starts as a draft, so it is published only from the editor, after the
// preview and a confirmation.

import { Banner, Dialog, FormControl, Select, Textarea, TextInput } from '@primer/react'
import { useId, useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'

import { reportStages, type ReportStage } from '../../../api/plugins/types'
import { stageWord } from '../../../domain/notices/reports'
import type { Affected } from '../../api/types'
import { useServiceList } from '../../data/public'
import { failureText, storeReport, useAdminAction } from '../../data/queries'

import styles from './form.module.css'
import { ImpactPicker } from './ImpactPicker'

export interface NewReportDialogProps {
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

interface Problems {
  title?: string
  message?: string
}

export function NewReportDialog({ onClose, returnFocusRef }: NewReportDialogProps) {
  const services = useServiceList()
  const formId = useId()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [stage, setStage] = useState<ReportStage>('investigating')
  const [message, setMessage] = useState('')
  const [affected, setAffected] = useState<Affected[]>([])
  const [problems, setProblems] = useState<Problems>({})
  const create = useAdminAction(
    (client, input: { title: string; message: string }) =>
      client.createReport({ ...input, stage, endpoints: affected, published: false }),
    (report, queryClient) => {
      storeReport(queryClient, report)
      const path = `/reports/${encodeURIComponent(report.id)}`
      void navigate(path)
      return { message: 'Draft created. Check the preview, then publish it.', path }
    },
    { sayFailures: false },
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found: Problems = {}
    if (title.trim() === '') {
      found.title = 'Enter a title.'
    }
    if (message.trim() === '') {
      found.message = 'Write the first update.'
    }
    setProblems(found)
    if (found.title === undefined && found.message === undefined) {
      create.mutate({ title: title.trim(), message })
    }
  }

  return (
    <Dialog
      title="New report"
      subtitle="It starts as a draft. Only people with a token can see it."
      width="xlarge"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        {
          content: 'Create draft',
          buttonType: 'primary',
          type: 'submit',
          form: formId,
          loading: create.isPending,
        },
      ]}
    >
      <form id={formId} className={styles.fields ?? ''} onSubmit={submit} noValidate>
        {create.isError ? (
          <Banner
            title="Not created"
            hideTitle
            variant="critical"
            description={failureText(create.error)}
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
          {problems.title === undefined ? null : (
            <FormControl.Validation variant="error">{problems.title}</FormControl.Validation>
          )}
        </FormControl>
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
          <FormControl.Label>First update</FormControl.Label>
          <Textarea
            block
            rows={4}
            maxLength={5000}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value)
            }}
          />
          {problems.message === undefined ? null : (
            <FormControl.Validation variant="error">{problems.message}</FormControl.Validation>
          )}
        </FormControl>
        <fieldset className={styles.fieldset ?? ''}>
          <legend className={styles.legend ?? ''}>Affected services</legend>
          <ImpactPicker
            idPrefix={`${formId}-impact`}
            services={services}
            value={affected}
            onChange={setAffected}
          />
        </fieldset>
      </form>
    </Dialog>
  )
}
