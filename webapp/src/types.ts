export type StageKind = 'main' | 'finals' | 'rerace'

export interface Entrant {
  id: string
  name: string
  carNumber: string
}

export interface Heat {
  id: string
  round: number
  heat: number
  lanes: Array<string | null>
  winnerId: string | null
}

export interface RaceGroup {
  id: string
  label: string
  kind: StageKind
  entrants: Entrant[]
  drawSeed: number
  heats: Heat[]
  /** Independent server revision. Missing legacy values are treated as revision 0. */
  revision?: number
}

export interface RaceClass {
  id: string
  name: string
  groups: RaceGroup[]
}

export interface Payment {
  nameKey: string
  displayName: string
  paid: number
}

export interface AuditItem {
  id: string
  at: string
  message: string
  action: 'edit' | 'draw' | 'result' | 'payment' | 'create'
  groupId?: string
  heatId?: string
  beforeWinnerId?: string | null
  afterWinnerId?: string | null
}

export interface EventData {
  id: string
  version: number
  name: string
  date: string
  venue: string
  entryFee: number
  status: 'draft' | 'live' | 'complete'
  mainClasses: RaceClass[]
  finalsClasses: RaceClass[]
  reraces: RaceGroup[]
  payments: Record<string, Payment>
  audit: AuditItem[]
  createdAt: string
  updatedAt: string
}

export interface GroupRecord {
  group: RaceGroup
  audit: AuditItem[]
  updatedAt: string
}

export interface Standing {
  entrant: Entrant
  wins: number
  losses: number
  completed: number
  rank: number
}
