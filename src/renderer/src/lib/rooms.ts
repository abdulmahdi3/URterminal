/**
 * Rooms — focused workspace presets for the parts of building that otherwise get
 * scattered across tabs and windows. A Command Room of role-labeled shells, a
 * Swarm Room of builder/reviewer/scout agents, and a Review Room that gathers
 * the context you need to decide what ships. Pure blueprints (unit-tested); the
 * RoomsModal applies them.
 */

export type RoomId = 'command' | 'swarm' | 'review'

export interface RoomRole {
  label: string
  hint: string
}

export interface RoomPaneSpec {
  kind: 'shell' | 'ai'
  label: string
}

export interface RoomBlueprint {
  id: RoomId
  name: string
  tagline: string
  /** the room's labeled parts, for the card + (review) the panel sections */
  roles: RoomRole[]
  /** panes to open when entering the room (empty for the Review Room) */
  panes: RoomPaneSpec[]
}

export const ROOMS: RoomBlueprint[] = [
  {
    id: 'command',
    name: 'Command Room',
    tagline: 'Shells, organized and tied to the task they’re executing.',
    roles: [
      { label: 'Dev server', hint: 'long-running' },
      { label: 'Test runner', hint: 'on demand' },
      { label: 'Agent shell', hint: 'commands' },
      { label: 'Review', hint: 'inspect the diff' }
    ],
    panes: [
      { kind: 'shell', label: 'Dev server' },
      { kind: 'shell', label: 'Test runner' },
      { kind: 'shell', label: 'Agent shell' },
      { kind: 'ai', label: 'Review' }
    ]
  },
  {
    id: 'swarm',
    name: 'Swarm Room',
    tagline: 'Launch builders, reviewers and scouts without a window maze.',
    roles: [
      { label: 'Builder', hint: 'implements' },
      { label: 'Reviewer', hint: 'watches the diff' },
      { label: 'Scout', hint: 'researches' }
    ],
    panes: [
      { kind: 'ai', label: 'Builder' },
      { kind: 'ai', label: 'Reviewer' },
      { kind: 'ai', label: 'Scout' }
    ]
  },
  {
    id: 'review',
    name: 'Review Room',
    tagline: 'See the context, inspect the output, decide when it’s ready to ship.',
    roles: [
      { label: 'Files changed', hint: 'git' },
      { label: 'Notes captured', hint: 'BridgeMemory' },
      { label: 'Checks', hint: 'tests / lint' },
      { label: 'Ship decision', hint: 'your call' }
    ],
    panes: []
  }
]

export function roomById(id: RoomId): RoomBlueprint {
  return ROOMS.find((r) => r.id === id) ?? ROOMS[0]
}

/** The Review Room's ship checklist (persisted per folder). */
export const SHIP_CHECKS = ['Files reviewed', 'Tests pass', 'Notes captured', 'Approved to ship']
