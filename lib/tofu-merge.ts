// Tofu: this file is Tofu's addition (2026-10-28), used by app/actions/data.ts (see TOFU.md).
import _ from 'lodash'

type Identified = { id: string }

export type ItemChange<T> =
  | { kind: 'added'; after: T }
  | { kind: 'removed'; before: T }
  | { kind: 'changed'; fields: string[]; before: T; after: T }

const isPrimitive = (value: unknown) =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value)

/**
 * A list field changed from `base` to `next` on one device, applied to the
 * stored list: what that device added is added and what it took away is taken
 * away, and what another device did meanwhile stays.
 */
function mergeList(current: unknown[], base: unknown[], next: unknown[]): unknown[] {
  const key = (value: unknown) => JSON.stringify(value)
  const count = (list: unknown[]) => {
    const counts = new Map<string, number>()
    for (const value of list) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1)
    return counts
  }
  const before = count(base)
  const after = count(next)
  const result = [...current]
  for (const [k, n] of before) {
    let remove = n - (after.get(k) ?? 0)
    for (let i = result.length - 1; i >= 0 && remove > 0; i--) {
      if (key(result[i]) === k) {
        result.splice(i, 1)
        remove--
      }
    }
  }
  const added = new Map<string, number>()
  for (const value of next) {
    const k = key(value)
    const want = (after.get(k) ?? 0) - (before.get(k) ?? 0)
    const done = added.get(k) ?? 0
    if (done < want) {
      result.push(value)
      added.set(k, done + 1)
    }
  }
  return result
}

function mergeItem<T extends Identified>(current: T, base: T, next: T): { item: T; fields: string[] } {
  const merged: Record<string, unknown> = { ...current }
  const b = base as Record<string, unknown>
  const n = next as Record<string, unknown>
  const fields: string[] = []
  for (const field of new Set([...Object.keys(b), ...Object.keys(n)])) {
    if (field === 'id' || _.isEqual(b[field], n[field])) continue
    fields.push(field)
    const [cur, was, now] = [merged[field], b[field], n[field]]
    if (Array.isArray(cur) && Array.isArray(was) && Array.isArray(now)
      && [...was, ...now].every(isPrimitive)) {
      merged[field] = mergeList(cur, was, now)
    } else if (now === undefined) {
      delete merged[field]
    } else {
      merged[field] = now
    }
  }
  return { item: merged as T, fields }
}

/**
 * Upstream's client sends the whole list it holds and the server wrote it over
 * the stored one, so a device that had not seen another's change undid it.
 * Here the client also sends the list it started from (`base`), and only what
 * it changed is applied to the stored list (`current`), item by item and
 * field by field: an item it added is added, one it removed is removed, a
 * field it changed is changed, and everything else keeps its stored value.
 * An item another device deleted stays deleted.
 */
export function mergeItems<T extends Identified>(
  current: T[],
  base: T[],
  next: T[],
): { items: T[]; changes: ItemChange<T>[] } {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const nextById = new Map(next.map((item) => [item.id, item]))
  const currentIds = new Set(current.map((item) => item.id))
  const items: T[] = []
  const changes: ItemChange<T>[] = []
  for (const item of current) {
    const now = nextById.get(item.id)
    const was = baseById.get(item.id)
    if (now && was) {
      const { item: merged, fields } = mergeItem(item, was, now)
      items.push(merged)
      if (fields.length > 0) changes.push({ kind: 'changed', fields, before: item, after: merged })
    } else if (now) {
      // Sent as new, but an item with its id is stored: the device's version replaces it.
      const { item: merged, fields } = mergeItem(item, item, now)
      items.push(merged)
      if (fields.length > 0) changes.push({ kind: 'changed', fields, before: item, after: merged })
    } else if (was) {
      changes.push({ kind: 'removed', before: item })
    } else {
      items.push(item)
    }
  }
  for (const item of next) {
    if (!currentIds.has(item.id) && !baseById.has(item.id)) {
      items.push(item)
      changes.push({ kind: 'added', after: item })
    }
  }
  return { items, changes }
}
