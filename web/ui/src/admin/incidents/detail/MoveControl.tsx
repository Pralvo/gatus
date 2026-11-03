// "Move": one button for each move the incidents plugin allows from the
// current state, and nothing else. "Close…" asks first, because a closed
// incident can no longer change.

import { Banner, Button, Dialog } from '@primer/react'
import { useRef, useState } from 'react'

import { stateWord, validMoves } from '../../../domain/admin/moves'
import type { AdminIncident, IncidentState } from '../../api/types'
import { storeIncident, useAdminAction } from '../../data/queries'
import styles from '../incidents.module.css'

export function MoveControl({ incident }: { incident: AdminIncident }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [asking, setAsking] = useState(false)
  const move = useAdminAction(
    (client, to: IncidentState) => client.setIncidentState(incident.id, to),
    (changed, queryClient, to) => {
      storeIncident(queryClient, changed)
      if (to === 'closed') {
        // The button that opened the dialog is gone; the section heading takes focus.
        heading.current?.focus()
        return { message: 'Closed. This incident can no longer change.' }
      }
      return { message: `Moved to ${stateWord(to)}.` }
    },
  )
  const moves = validMoves(incident.state)
  const cancel = () => {
    setAsking(false)
  }

  return (
    <section aria-labelledby="move-heading">
      <h2 id="move-heading" ref={heading} tabIndex={-1} className={styles.h2 ?? ''}>
        Move
      </h2>
      {moves.length === 0 ? (
        <Banner
          title="Closed"
          hideTitle
          variant="info"
          description="Closed. This incident can no longer change."
        />
      ) : (
        <div className={styles.moves ?? ''}>
          {moves.map((to) =>
            to === 'closed' ? (
              <Button
                key={to}
                ref={closeButton}
                disabled={move.isPending}
                onClick={() => {
                  setAsking(true)
                }}
              >
                Close…
              </Button>
            ) : (
              <Button
                key={to}
                disabled={move.isPending}
                onClick={() => {
                  move.mutate(to)
                }}
              >
                Move to {stateWord(to)}
              </Button>
            ),
          )}
        </div>
      )}
      {asking ? (
        <Dialog
          title="Close this incident?"
          onClose={cancel}
          returnFocusRef={closeButton}
          footerButtons={[
            { content: 'Cancel', onClick: cancel },
            {
              content: 'Close incident',
              buttonType: 'danger',
              onClick: () => {
                setAsking(false)
                move.mutate('closed')
              },
            },
          ]}
        >
          <p className={styles.note ?? ''}>
            A closed incident can no longer change: no moves, notes or edits.
          </p>
        </Dialog>
      ) : null}
    </section>
  )
}
