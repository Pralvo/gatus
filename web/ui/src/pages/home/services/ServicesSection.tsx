import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react'
import { Button, IconButton } from '@primer/react'
import { SkeletonText } from '@primer/react/experimental'

import {
  groupHeading,
  listServices,
  noMatchMessage,
  showsListControls,
  type ServiceGroup,
} from '../../../domain/services/listing'
import { groupSentence } from '../../../domain/services/row'
import home from '../home.module.css'
import type { HomeView } from '../useHomeView'

import { ListControls } from './ListControls'
import { ServiceRow } from './ServiceRow'
import styles from './services.module.css'
import { useListChoices, type ListChoices } from './useListChoices'

const skeletonRows = 5

/** Five skeleton rows while the statuses load. */
export function ServicesSkeleton() {
  return (
    <section className={home.part ?? ''} aria-label="Services" aria-busy="true">
      <SkeletonText size="titleSmall" maxWidth="120px" />
      <div className={home.box ?? ''}>
        {Array.from({ length: skeletonRows }, (_, index) => (
          <div key={index} className={home.skeletonRow ?? ''}>
            <SkeletonText maxWidth="160px" />
            <SkeletonText size="titleMedium" />
          </div>
        ))}
      </div>
    </section>
  )
}

function Group({
  group,
  count,
  view,
  choices,
}: {
  group: ServiceGroup
  count: number
  view: HomeView
  choices: ListChoices
}) {
  const heading = groupHeading(group, count)
  const open = !choices.collapsed.includes(heading)
  const listId = `group-${heading.replace(/\W+/g, '-')}`
  return (
    <section
      className={`${home.box ?? ''} ${styles.group ?? ''} ${open ? (styles.open ?? '') : ''}`}
      aria-label={heading}
    >
      <div className={styles.head ?? ''}>
        <IconButton
          icon={open ? ChevronDownIcon : ChevronRightIcon}
          variant="invisible"
          size="small"
          aria-label={`${open ? 'Hide' : 'Show'} ${heading}`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            choices.toggleGroup(heading)
          }}
        />
        <h3 className={styles.h3 ?? ''}>{heading}</h3>
        <p className={styles.sentence ?? ''}>{groupSentence(group.services)}</p>
      </div>
      <ul className={styles.list ?? ''} id={listId} hidden={!open}>
        {group.services.map((service) => (
          <ServiceRow
            key={service.key}
            service={service}
            results={view.results.get(service.key) ?? []}
            reference={view.reference}
            stale={view.stale}
            travelAt={view.travel?.at ?? null}
          />
        ))}
      </ul>
    </section>
  )
}

/** "Services": one box per configured group, each row a service (spec 4.1 item 5). */
export function ServicesSection({ view }: { view: HomeView }) {
  const choices = useListChoices()
  const controls = showsListControls(view.services.length)
  const groups = listServices(
    view.services,
    controls
      ? { query: choices.query, filterBy: choices.filterBy, sortBy: choices.sortBy }
      : { query: '', filterBy: 'none', sortBy: 'group' },
  )
  return (
    <section id="services" className={home.part ?? ''} aria-labelledby="services-heading">
      <h2 id="services-heading" className={home.h2 ?? ''} tabIndex={-1}>
        Services
      </h2>
      <p className={home.sub ?? ''}>
        Every check, newest on the right. Failed checks stand taller.
      </p>
      {controls ? <ListControls choices={choices} /> : null}
      {groups.length === 0 ? (
        <div className={`${home.box ?? ''} ${styles.empty ?? ''}`} role="status">
          <p>{noMatchMessage}</p>
          <Button size="small" onClick={choices.showAll}>
            Show all
          </Button>
        </div>
      ) : (
        groups.map((group) => (
          <Group
            key={group.name}
            group={group}
            count={groups.length}
            view={view}
            choices={choices}
          />
        ))
      )}
    </section>
  )
}
