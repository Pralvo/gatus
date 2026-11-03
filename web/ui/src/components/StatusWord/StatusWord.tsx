import type { Icon } from '@primer/octicons-react'
import type { ReactNode } from 'react'

import type { Tone } from '../../domain/status/service'

import styles from './StatusWord.module.css'

const toneClasses = new Map<Tone, string | undefined>([
  ['success', styles.success],
  ['attention', styles.attention],
  ['severe', styles.severe],
  ['danger', styles.danger],
  ['neutral', styles.neutral],
])

export interface StatusWordProps {
  tone: Tone
  icon: Icon
  children: ReactNode
}

/** A status in words, coloured by tone and repeated by an icon, so colour is never alone. */
export function StatusWord({ tone, icon: Glyph, children }: StatusWordProps) {
  return (
    <span className={`${styles.word ?? ''} ${toneClasses.get(tone) ?? ''}`} data-tone={tone}>
      <Glyph size={16} aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}
