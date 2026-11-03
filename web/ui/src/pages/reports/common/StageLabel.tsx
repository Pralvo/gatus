import { Label, type LabelColorOptions } from '@primer/react'

import type { ReportStage } from '../../../api/plugins/types'
import { stageWord } from '../../../domain/notices/reports'

const variants = new Map<ReportStage, LabelColorOptions>([
  ['investigating', 'danger'],
  ['identified', 'attention'],
  ['monitoring', 'secondary'],
  ['resolved', 'success'],
])

/** A report's stage in words; the colour only repeats them. */
export function StageLabel({ stage, size }: { stage: ReportStage; size?: 'small' | 'large' }) {
  return (
    <Label variant={variants.get(stage) ?? 'secondary'} size={size ?? 'small'}>
      {stageWord(stage)}
    </Label>
  )
}
