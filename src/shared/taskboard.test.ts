import { describe, it, expect } from 'vitest'
import {
  defaultBoard,
  normalizeBoard,
  addCard,
  removeCard,
  updateCard,
  moveCard,
  findCard,
  adjacentColumn,
  type TaskCard
} from './taskboard'

const card = (id: string, title = id): TaskCard => ({ id, title, created: 1 })

describe('taskboard', () => {
  it('default board has the three columns', () => {
    expect(defaultBoard().columns.map((c) => c.id)).toEqual(['backlog', 'doing', 'done'])
  })

  it('adds a card to the head of a column', () => {
    const b = addCard(addCard(defaultBoard(), 'backlog', card('a')), 'backlog', card('b'))
    expect(b.columns[0].cards.map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('moves a card between columns', () => {
    let b = addCard(defaultBoard(), 'backlog', card('a'))
    b = moveCard(b, 'a', 'doing')
    expect(findCard(b, 'a')?.columnId).toBe('doing')
    expect(b.columns[0].cards).toHaveLength(0)
  })

  it('move is a no-op for an unknown column or card', () => {
    const b = addCard(defaultBoard(), 'backlog', card('a'))
    expect(moveCard(b, 'a', 'nope')).toBe(b)
    expect(moveCard(b, 'ghost', 'doing')).toBe(b)
  })

  it('removes and updates cards immutably', () => {
    const b0 = addCard(defaultBoard(), 'backlog', card('a'))
    const b1 = updateCard(b0, 'a', { title: 'renamed' })
    expect(findCard(b1, 'a')?.card.title).toBe('renamed')
    expect(b0.columns[0].cards[0].title).toBe('a') // original untouched
    expect(removeCard(b1, 'a').columns[0].cards).toHaveLength(0)
  })

  it('adjacentColumn steps toward done and back, clamped', () => {
    expect(adjacentColumn('backlog', 1)).toBe('doing')
    expect(adjacentColumn('doing', 1)).toBe('done')
    expect(adjacentColumn('done', 1)).toBeNull()
    expect(adjacentColumn('backlog', -1)).toBeNull()
  })

  it('normalizeBoard coerces junk into the canonical 3 columns', () => {
    const raw = { columns: [{ id: 'doing', cards: [{ title: 'x' }, { id: 'k', title: 'y', created: 9 }] }] }
    const b = normalizeBoard(raw)
    expect(b.columns.map((c) => c.id)).toEqual(['backlog', 'doing', 'done'])
    expect(b.columns[1].cards).toHaveLength(2)
    expect(b.columns[1].cards[1]).toMatchObject({ id: 'k', title: 'y', created: 9 })
    expect(normalizeBoard(null).columns).toHaveLength(3)
  })
})
