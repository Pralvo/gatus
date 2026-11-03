import { DeviceDesktopIcon, MoonIcon, SunIcon } from '@primer/octicons-react'
import { ActionList, ActionMenu, IconButton } from '@primer/react'

import type { ThemeChoice } from '../app/theme'

const choices = [
  { value: 'system', label: 'System', icon: DeviceDesktopIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
] as const satisfies readonly { value: ThemeChoice; label: string; icon: unknown }[]

export interface ThemeMenuProps {
  choice: ThemeChoice
  onChoose: (choice: ThemeChoice) => void
}

/** The header's theme picker: System, Light or Dark. */
export function ThemeMenu({ choice, onChoose }: ThemeMenuProps) {
  const current = choices.find((item) => item.value === choice) ?? choices[0]
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton icon={current.icon} variant="invisible" aria-label={`Theme: ${choice}`} />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay width="small">
        <ActionList selectionVariant="single" aria-label="Theme">
          {choices.map((item) => (
            <ActionList.Item
              key={item.value}
              selected={item.value === choice}
              onSelect={() => {
                onChoose(item.value)
              }}
            >
              {item.label}
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
