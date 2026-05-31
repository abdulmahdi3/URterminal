import { app, BrowserWindow } from 'electron'

// Temporary performance-measurement harness (enabled by URTERMINAL_MEASURE=1).
// Drives the REAL renderer via executeJavaScript and samples EVERY Electron
// process (main + renderer + GPU + utility) with app.getAppMetrics(), so the
// numbers reflect the actual running app. Prints one `MEASURE_RESULT <json>`
// line and exits. Safe to delete — nothing in the app imports it.

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const round = (n: number, d = 1): number => Math.round(n * 10 ** d) / 10 ** d

interface RoleAgg {
  cpuAvg: number
  cpuMax: number
  memMB: number
}

export async function runMeasure(win: BrowserWindow): Promise<void> {
  const exec = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code)
  const rendererPid = win.webContents.getOSProcessId()

  // One getAppMetrics() snapshot → { role: { cpu, memMB, n } } summed per role.
  const snap = (): Record<string, { cpu: number; memMB: number }> => {
    const per: Record<string, { cpu: number; memMB: number }> = {}
    for (const m of app.getAppMetrics()) {
      let role: string
      if (m.pid === rendererPid) role = 'Renderer'
      else if (m.type === 'Browser') role = 'Main'
      else if (m.type === 'GPU') role = 'GPU'
      else role = m.type // Utility, Zygote, etc.
      const e = (per[role] ??= { cpu: 0, memMB: 0 })
      e.cpu += m.cpu?.percentCPUUsage ?? 0
      e.memMB += (m.memory?.workingSetSize ?? 0) / 1024 // workingSetSize is KB
    }
    return per
  }

  // Sample every 500ms for `ms`; aggregate avg/max CPU and last-seen RAM per role.
  const sampleFor = async (
    ms: number
  ): Promise<{ roles: Record<string, RoleAgg>; totalMemMB: number; rendererCpuSeries: number[] }> => {
    const samples: Record<string, { cpu: number; memMB: number }>[] = []
    snap() // prime (percentCPUUsage is measured since the previous call)
    const start = Date.now()
    while (Date.now() - start < ms) {
      await wait(500)
      samples.push(snap())
    }
    const roleNames = new Set<string>()
    samples.forEach((s) => Object.keys(s).forEach((r) => roleNames.add(r)))
    const roles: Record<string, RoleAgg> = {}
    for (const r of roleNames) {
      const cpus = samples.map((s) => s[r]?.cpu ?? 0)
      const mems = samples.map((s) => s[r]?.memMB ?? 0)
      roles[r] = {
        cpuAvg: round(cpus.reduce((a, b) => a + b, 0) / cpus.length),
        cpuMax: round(Math.max(...cpus)),
        memMB: Math.round(mems[mems.length - 1] ?? 0)
      }
    }
    const last = samples[samples.length - 1] ?? {}
    const totalMemMB = Math.round(Object.values(last).reduce((a, b) => a + b.memMB, 0))
    const rendererCpuSeries = samples.map((s) => round(s.Renderer?.cpu ?? 0))
    return { roles, totalMemMB, rendererCpuSeries }
  }

  const result: Record<string, unknown> = {}
  try {
    // ---- startup ----
    const nav = await exec<string>(
      `JSON.stringify((()=>{const n=performance.getEntriesByType('navigation')[0]||{};` +
        `return {domInteractiveMs:Math.round(n.domInteractive||0),` +
        `domContentLoadedMs:Math.round(n.domContentLoadedEventEnd||0),` +
        `loadEventMs:Math.round(n.loadEventEnd||0)};})())`
    )
    result.startup = {
      mainStartToRendererLoadedSec: round(process.uptime(), 2),
      rendererNav: JSON.parse(nav)
    }

    // Install a counter for pty:data IPC messages delivered to the renderer.
    // End with `true` so executeJavaScript resolves a cloneable value (not the
    // unsubscribe function onPtyData returns).
    await exec(`window.__m={n:0}; window.__moff=window.api.onPtyData(()=>{window.__m.n++}); true`)

    // ---- idle: empty window (true floor) ----
    await wait(1500)
    result.idleEmpty = await sampleFor(5000)

    // ---- idle: one claude agent pane open ----
    await exec(`window.__ws.getState().addPane('ai', undefined, { agentCommand: 'claude', label: 'Claude' })`)
    await wait(5000) // let the agent CLI boot + paint its UI
    await exec(`window.__m.n=0`)
    result.idleClaude = await sampleFor(8000)
    const idleEvents = await exec<number>(`window.__m.n`)
    ;(result.idleClaude as Record<string, unknown>).ipcEventsPerSec = round(idleEvents / 8)

    // ---- heavy output burst (shell dumping ~20k lines) ----
    await exec(`window.__ws.getState().addPane('shell', undefined, { shell: 'powershell.exe' })`)
    await wait(3000)
    let ptyId = await exec<string | null>(
      `(()=>{const ps=Object.values(window.__ws.getState().panes).filter(p=>p.type==='shell');` +
        `const sh=ps[ps.length-1];return sh&&sh.shell?sh.shell.ptyId||null:null;})()`
    )
    if (!ptyId) {
      await wait(2500)
      ptyId = await exec<string | null>(
        `(()=>{const ps=Object.values(window.__ws.getState().panes).filter(p=>p.type==='shell');` +
          `const sh=ps[ps.length-1];return sh&&sh.shell?sh.shell.ptyId||null:null;})()`
      )
    }
    result.shellPtySpawned = !!ptyId
    if (ptyId) {
      const heavy = '1..20000 | % { "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ row $_ render stress" }\r'
      await exec(`window.__m.n=0`)
      await exec(`window.api.writePty(${JSON.stringify(ptyId)}, ${JSON.stringify(heavy)})`)
      result.heavyOutput = await sampleFor(6000)
      const heavyEvents = await exec<number>(`window.__m.n`)
      ;(result.heavyOutput as Record<string, unknown>).ipcEvents = heavyEvents
      ;(result.heavyOutput as Record<string, unknown>).ipcEventsPerSec = round(heavyEvents / 6)

      // ---- steady stream (~50 small writes/sec — mimics an animating TUI) ----
      const steady = '1..250 | % { "tick $_"; Start-Sleep -Milliseconds 20 }\r'
      await exec(`window.__m.n=0`)
      await exec(`window.api.writePty(${JSON.stringify(ptyId)}, ${JSON.stringify(steady)})`)
      result.steadyStream = await sampleFor(5500)
      const steadyEvents = await exec<number>(`window.__m.n`)
      ;(result.steadyStream as Record<string, unknown>).ipcEventsPerSec = round(steadyEvents / 5.5)
    }

    result.paneCount = await exec<number>(`Object.keys(window.__ws.getState().panes).length`)
    console.log('MEASURE_RESULT ' + JSON.stringify(result))
    app.exit(0)
  } catch (e) {
    console.log('MEASURE_ERROR ' + (e as Error).message)
    console.log('MEASURE_PARTIAL ' + JSON.stringify(result))
    app.exit(2)
  }
}
