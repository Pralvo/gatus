// Counts failed refreshes in a row for each query. React Query resets its own
// failure count at the start of every fetch, so it cannot tell three failed
// minutes from one; this count lives until the next success.

import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

const streaks = new WeakMap<QueryClient, Map<string, number>>()

function streaksOf(client: QueryClient): Map<string, number> {
  let map = streaks.get(client)
  if (map === undefined) {
    map = new Map()
    streaks.set(client, map)
  }
  return map
}

/** Failed refreshes of a query since its last success. */
export function failuresInRow(client: QueryClient, queryKey: QueryKey): number {
  return streaksOf(client).get(hashKey(queryKey)) ?? 0
}

/** Wraps a fetcher so its failures and successes update the count. */
export function counted<T>(
  client: QueryClient,
  queryKey: QueryKey,
  fetcher: () => Promise<T>,
): () => Promise<T> {
  return async () => {
    const map = streaksOf(client)
    const hash = hashKey(queryKey)
    try {
      const data = await fetcher()
      map.set(hash, 0)
      return data
    } catch (error) {
      map.set(hash, (map.get(hash) ?? 0) + 1)
      throw error
    }
  }
}
