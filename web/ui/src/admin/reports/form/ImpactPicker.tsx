// Affected services with their impact: one choice per monitored service, plus
// any key the report already names that this server no longer monitors.

import { FormControl, Select } from '@primer/react'

import type { Impact } from '../../../api/plugins/types'
import { impactChoices, impactOf, withImpact } from '../../../domain/admin/affected'
import type { Affected } from '../../api/types'

import styles from './form.module.css'

export interface PickerService {
  key: string
  name: string
  group: string
}

export interface ImpactPickerProps {
  services: readonly PickerService[]
  value: readonly Affected[]
  onChange: (next: Affected[]) => void
  /** Prefix for the field ids, so two pickers never share one. */
  idPrefix: string
}

const noImpact = 'none'

function rowsOf(services: readonly PickerService[], value: readonly Affected[]): PickerService[] {
  const known = new Set(services.map((service) => service.key))
  const gone = value
    .filter((entry) => !known.has(entry.key))
    .map((entry) => ({ key: entry.key, name: entry.key, group: 'No longer monitored' }))
  return [...services, ...gone]
}

export function ImpactPicker({ services, value, onChange, idPrefix }: ImpactPickerProps) {
  return (
    <div className={styles.picker ?? ''}>
      {rowsOf(services, value).map((service) => (
        <FormControl key={service.key} id={`${idPrefix}-${service.key}`}>
          <FormControl.Label>{service.name}</FormControl.Label>
          {service.group === '' ? null : <FormControl.Caption>{service.group}</FormControl.Caption>}
          <Select
            value={impactOf(value, service.key) ?? noImpact}
            onChange={(event) => {
              const chosen = impactChoices.find(
                (choice) => (choice.value ?? noImpact) === event.target.value,
              )
              const impact: Impact | null = chosen?.value ?? null
              onChange(withImpact(value, service.key, impact))
            }}
          >
            {impactChoices.map((choice) => (
              <Select.Option key={choice.label} value={choice.value ?? noImpact}>
                {choice.label}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
      ))}
    </div>
  )
}
