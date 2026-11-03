import { useTheme } from '@primer/react/next'
import { NavLink } from 'react-router'

import type { ThemeChoice } from '../app/theme'
import { usePageConfig } from '../config/context'

import styles from './layout.module.css'
import { ThemeMenu } from './ThemeMenu'

export interface HeaderProps {
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
}

/** The configured logo, in its dark version when the dark theme is showing. */
function Logo() {
  const { logo, logoDark } = usePageConfig()
  const { resolvedColorMode } = useTheme()
  const dark = resolvedColorMode === 'night' || resolvedColorMode === 'dark'
  const source = dark && logoDark !== '' ? logoDark : logo
  if (source === '') {
    return null
  }
  // The name beside it says what the page is, so the image needs no text.
  return <img className={styles.logo ?? ''} src={source} alt="" width={24} height={24} />
}

export function Header({ theme, onTheme }: HeaderProps) {
  const { header } = usePageConfig()
  return (
    <header className={styles.header ?? ''}>
      <div className={`pralvo-wrap ${styles.headerRow ?? ''}`}>
        <NavLink to="/" className={styles.brand ?? ''} end>
          <Logo />
          <span>{header}</span>
        </NavLink>
        <nav aria-label="Main" className={styles.nav ?? ''}>
          <NavLink to="/" end>
            Status
          </NavLink>
          <NavLink to="/reports">Reports</NavLink>
        </nav>
        <ThemeMenu choice={theme} onChoose={onTheme} />
      </div>
    </header>
  )
}
