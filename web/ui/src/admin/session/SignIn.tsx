// The sign-in screen. The token is pasted into a password field, checked with
// one read, and only then kept. The field is emptied on every attempt, so the
// token never stays in the page's state.

import { Banner, Button, FormControl, TextInput } from '@primer/react'
import { useRef, useState, type FormEvent } from 'react'

import { AdminError, failureMessages } from '../api/client'
import { AdminHeading, useDocumentTitle } from '../shell/page'

import { useSession } from './Session'
import styles from './session.module.css'

export function SignIn() {
  const { signIn, endedBecause } = useSession()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useDocumentTitle('Sign in')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const field = input.current
    const token = field?.value.trim() ?? ''
    if (field !== null) {
      field.value = ''
    }
    if (token.length === 0) {
      setError('Enter a token.')
      field?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await signIn(token)
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : failureMessages.unreachable)
      setBusy(false)
      field?.focus()
    }
  }

  return (
    <div className={styles.box ?? ''}>
      <AdminHeading>Sign in</AdminHeading>
      <p>
        Paste an API token. It is kept only in this browser tab and is forgotten when the tab
        closes.
      </p>
      <div role="status" aria-live="polite">
        {endedBecause === null || error !== null ? null : (
          <Banner
            title="Signed out"
            hideTitle
            description={endedBecause.text}
            variant={endedBecause.critical ? 'critical' : 'info'}
          />
        )}
      </div>
      <form
        className={styles.form ?? ''}
        autoComplete="off"
        onSubmit={(event) => void submit(event)}
      >
        <FormControl required>
          <FormControl.Label>Token</FormControl.Label>
          <TextInput
            ref={input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            block
            {...(error === null ? {} : { validationStatus: 'error' as const })}
          />
          {error === null ? null : (
            <FormControl.Validation variant="error">{error}</FormControl.Validation>
          )}
        </FormControl>
        <Button type="submit" variant="primary" loading={busy}>
          Sign in
        </Button>
      </form>
    </div>
  )
}
