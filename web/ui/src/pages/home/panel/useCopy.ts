import { useCallback, useState } from 'react'

export interface Copier {
  /** What the last copy did, for a status message; '' before any. */
  message: string
  copy: (text: string, what: string) => Promise<void>
}

/** Copies text to the clipboard and says whether it worked, without alerts. */
export function useCopy(): Copier {
  const [message, setMessage] = useState('')
  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMessage(`${what} copied.`)
    } catch {
      setMessage(`Your browser did not allow copying the ${what.toLowerCase()}.`)
    }
  }, [])
  return { message, copy }
}
