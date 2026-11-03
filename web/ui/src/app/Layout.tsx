import { Outlet } from 'react-router'

import { Footer } from '../layout/Footer'
import { Header, type HeaderProps } from '../layout/Header'

/** Every public page: header, the page itself, footer. */
export function Layout(props: HeaderProps) {
  return (
    <>
      <a className="pralvo-skip" href="#main">
        Skip to the content
      </a>
      <Header {...props} />
      <main id="main" className="pralvo-main">
        <div className="pralvo-wrap">
          <Outlet />
        </div>
      </main>
      <Footer />
    </>
  )
}
