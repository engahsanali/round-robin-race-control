import type { Entrant, EventData, RaceClass, RaceGroup, StageKind } from './types'

const NEW_CLASSES = [
  { name: 'Stock Advance', slug: 'stock-advance' },
  { name: 'BMAX Speed', slug: 'bmax-speed' },
]
export const CLASS_NAMES = ['Box Stock', NEW_CLASSES[0].name, 'BMAX NCFM', 'BMAX Mixed', NEW_CLASSES[1].name, 'Open']
export const CLASS_COUNT = CLASS_NAMES.length
export const LEGACY_CLASS_COUNT = CLASS_COUNT - NEW_CLASSES.length
const MAX_ENTRANTS = 21

export function makeId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID()}`
}

export function blankEntrants(groupId?: string): Entrant[] {
  return Array.from({ length: MAX_ENTRANTS }, (_, i) => ({
    id: groupId ? `${groupId}-slot-${i + 1}` : makeId(`slot-${i + 1}`),
    name: '', carNumber: '',
  }))
}

export function makeGroups(kind: StageKind, labels: string[], classId?: string): RaceGroup[] {
  return labels.map((label, index) => {
    const stableId = classId && `${classId}-${index + 1}`
    const drawSeed = stableId ? Array.from(stableId).reduce((seed, char) => (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0, 0) : randomSeed()
    return {
      id: stableId || makeId(`${kind}-${index + 1}`), label, kind,
      entrants: blankEntrants(stableId), drawSeed, heats: [], revision: 0,
    }
  })
}

export function makeClass(kind: 'main' | 'finals', name: string, stableId?: string): RaceClass {
  const groupLabel = kind === 'main' ? 'Bracket' : 'Final'
  return {
    id: stableId ?? makeId(kind),
    name,
    groups: makeGroups(kind, Array.from({ length: 6 }, (_, i) => `${groupLabel} ${String.fromCharCode(65 + i)}`), stableId),
  }
}

export function addMissingClasses(event: EventData): EventData {
  if (event.mainClasses.length !== LEGACY_CLASS_COUNT || event.finalsClasses.length !== LEGACY_CLASS_COUNT) return event
  // Keep existing class positions and give newly added groups the same IDs online and offline.
  const additions = (kind: 'main' | 'finals') => NEW_CLASSES.map(({ name, slug }) => makeClass(kind, name, `category-v2-${kind}-${slug}-${event.id}`))
  return {
    ...event,
    mainClasses: [...event.mainClasses, ...additions('main')],
    finalsClasses: [...event.finalsClasses, ...additions('finals')],
  }
}

export function randomSeed(): number {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] || 1
}
