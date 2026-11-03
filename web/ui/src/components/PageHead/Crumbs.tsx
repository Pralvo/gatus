import { Breadcrumbs } from '@primer/react'
import { Link } from 'react-router'

export interface CrumbsProps {
  /** The group the page belongs to, shown as plain text; empty leaves it out. */
  group: string
  /** The page itself. */
  name: string
}

/** "Status / group / name" (spec 4.2 and 4.3). Server names are shown as text. */
export function Crumbs({ group, name }: CrumbsProps) {
  return (
    <Breadcrumbs>
      <Breadcrumbs.Item as={Link} to="/">
        Status
      </Breadcrumbs.Item>
      {group === '' ? null : <Breadcrumbs.Item as="span">{group}</Breadcrumbs.Item>}
      <Breadcrumbs.Item as="span" selected>
        {name}
      </Breadcrumbs.Item>
    </Breadcrumbs>
  )
}
