// The admin's frame: a header with the way back to the status page, the theme
// and "Sign out", then the sign-in screen or the signed-in workspace.

import { Button, NavList, PageLayout, UnderlineNav } from '@primer/react'
import { Link, Outlet, useLocation } from 'react-router'

import type { ThemeChoice } from '../../app/theme'
import { ThemeMenu } from '../../layout/ThemeMenu'
import { useSession } from '../session/Session'
import { SignIn } from '../session/SignIn'

import { NoticeArea, NoticeProvider } from './notice'
import styles from './shell.module.css'

export interface AdminFrameProps {
  theme: ThemeChoice
  onTheme: (choice: ThemeChoice) => void
}

const sections = [
  { to: '/', label: 'Reports', match: (path: string) => !path.startsWith('/incidents') },
  { to: '/incidents', label: 'Incidents', match: (path: string) => path.startsWith('/incidents') },
] as const

/** The signed-in pages: a navigation pane, or tabs at narrow widths, beside the page. */
function Workspace() {
  const { pathname } = useLocation()
  const current = (match: (path: string) => boolean) =>
    match(pathname) ? { 'aria-current': 'page' as const } : {}
  return (
    <PageLayout containerWidth="xlarge" padding="none" columnGap="normal">
      <PageLayout.Pane position="start" width="small" hidden={{ narrow: true }}>
        <NavList aria-label="Admin">
          {sections.map((section) => (
            <NavList.Item key={section.to} as={Link} to={section.to} {...current(section.match)}>
              {section.label}
            </NavList.Item>
          ))}
        </NavList>
      </PageLayout.Pane>
      <PageLayout.Content>
        <div className={styles.narrowNav ?? ''}>
          <UnderlineNav aria-label="Admin sections">
            {sections.map((section) => (
              <UnderlineNav.Item
                key={section.to}
                as={Link}
                to={section.to}
                {...current(section.match)}
              >
                {section.label}
              </UnderlineNav.Item>
            ))}
          </UnderlineNav>
        </div>
        <NoticeArea />
        <Outlet />
      </PageLayout.Content>
    </PageLayout>
  )
}

export function AdminFrame({ theme, onTheme }: AdminFrameProps) {
  const { client, signOut } = useSession()
  return (
    <NoticeProvider>
      <a className="pralvo-skip" href="#main">
        Skip to the page
      </a>
      <header className={styles.header ?? ''}>
        <div className={styles.headerRow ?? ''}>
          <span className={styles.brand ?? ''}>Pralvo status admin</span>
          <a href="/" className={styles.back ?? ''}>
            Status page
          </a>
          <ThemeMenu choice={theme} onChoose={onTheme} />
          {client === null ? null : (
            <Button
              size="small"
              onClick={() => {
                signOut('Signed out.')
              }}
            >
              Sign out
            </Button>
          )}
        </div>
      </header>
      <main id="main" className={styles.main ?? ''}>
        {client === null ? <SignIn /> : <Workspace />}
      </main>
    </NoticeProvider>
  )
}
