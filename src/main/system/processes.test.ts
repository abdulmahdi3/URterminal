import { describe, it, expect } from 'vitest'
import { parsePsWin, parsePsPosix, parseCpuTime, computeProcs, type RawProc } from './processes'

describe('parsePsWin', () => {
  it('parses pid|name|workingSet|cpuMs lines and skips junk', () => {
    const out = ['1234|node|536870912|4200', 'bad-line', '0|idle|0|0', '5|claude|104857600|150'].join(
      '\n'
    )
    const rows = parsePsWin(out)
    expect(rows.map((r) => r.pid)).toEqual([1234, 5]) // pid 0 dropped, junk dropped
    expect(rows[0]).toMatchObject({ name: 'node', rssBytes: 536870912, cpuMs: 4200 })
  })
})

describe('parseCpuTime', () => {
  it('parses M:S(.cc) (macOS short form)', () => {
    expect(parseCpuTime('0:00.00')).toBe(0)
    expect(parseCpuTime('1:30.50')).toBe(90500)
  })
  it('parses H:M:S', () => {
    expect(parseCpuTime('1:02:03')).toBe((3600 + 123) * 1000)
  })
  it('parses D-H:M:S (days)', () => {
    expect(parseCpuTime('2-01:00:00')).toBe((2 * 86400 + 3600) * 1000)
  })
  it('is 0 for empty / garbage', () => {
    expect(parseCpuTime('')).toBe(0)
  })
})

describe('parsePsPosix', () => {
  it('parses pid/rss/time/comm, basenames the command, converts rss KB→bytes', () => {
    const out = [
      '  501 123456 0:01.23 /usr/bin/node',
      '  777   2048 1:00:00 com.apple.WebKit.WebContent',
      'garbage'
    ].join('\n')
    const rows = parsePsPosix(out)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ pid: 501, name: 'node', rssBytes: 123456 * 1024 })
    expect(rows[0].cpuMs).toBe(1230)
    expect(rows[1].name).toBe('com.apple.WebKit.WebContent')
  })
})

describe('computeProcs', () => {
  it('derives CPU% from the cumulative-time delta across samples', () => {
    const rows: RawProc[] = [{ pid: 1, name: 'a', rssBytes: 1024 * 1024 * 10, cpuMs: 2000 }]
    // first sample: no prior, so 0%
    const first = computeProcs(rows, 1000, new Map(), 0, 4)
    expect(first.procs[0].cpuPercent).toBe(0)
    expect(first.procs[0].memMB).toBe(10)
    // second sample 1s later, +1000ms CPU on 4 cores → 1000/1000/4*100 = 25%
    const rows2: RawProc[] = [{ pid: 1, name: 'a', rssBytes: 0, cpuMs: 3000 }]
    const second = computeProcs(rows2, 2000, first.nextCpu, first.at, 4)
    expect(second.procs[0].cpuPercent).toBe(25)
  })

  it('clamps CPU% to 0..100 and drops invalid pids', () => {
    const rows: RawProc[] = [
      { pid: 0, name: 'idle', rssBytes: 0, cpuMs: 0 },
      { pid: 9, name: 'busy', rssBytes: 0, cpuMs: 999999 }
    ]
    const r = computeProcs(rows, 2000, new Map([[9, 0]]), 1000, 1)
    expect(r.procs).toHaveLength(1)
    expect(r.procs[0].cpuPercent).toBe(100)
  })
})
