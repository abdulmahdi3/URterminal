import { describe, it, expect } from 'vitest'
import { ROOMS, roomById, SHIP_CHECKS } from './rooms'

describe('rooms', () => {
  it('defines exactly the three rooms', () => {
    expect(ROOMS.map((r) => r.id)).toEqual(['command', 'swarm', 'review'])
  })
  it('Command Room opens role shells + a review agent', () => {
    const c = roomById('command')
    expect(c.panes).toHaveLength(4)
    expect(c.panes.filter((p) => p.kind === 'shell')).toHaveLength(3)
    expect(c.panes.find((p) => p.kind === 'ai')?.label).toBe('Review')
  })
  it('Swarm Room opens three agents', () => {
    const s = roomById('swarm')
    expect(s.panes.map((p) => p.label)).toEqual(['Builder', 'Reviewer', 'Scout'])
    expect(s.panes.every((p) => p.kind === 'ai')).toBe(true)
  })
  it('Review Room opens no panes (it is a panel)', () => {
    expect(roomById('review').panes).toHaveLength(0)
  })
  it('has a ship checklist', () => {
    expect(SHIP_CHECKS.length).toBe(4)
    expect(SHIP_CHECKS).toContain('Tests pass')
  })
  it('roomById falls back to the first room for an unknown id', () => {
    expect(roomById('nope' as never).id).toBe('command')
  })
})
