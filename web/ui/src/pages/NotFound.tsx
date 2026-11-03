import { Heading } from '@primer/react'
import { useEffect } from 'react'
import { Link } from 'react-router'

import { usePageConfig } from '../config/context'

export function NotFound() {
  const { header } = usePageConfig()
  useEffect(() => {
    document.title = `Not found · ${header}`
  }, [header])
  return (
    <>
      <Heading as="h1" variant="medium">
        There is nothing at this address
      </Heading>
      <p>
        <Link to="/">Go to the status page</Link>
      </p>
    </>
  )
}
