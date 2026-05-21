import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/types'

// Scripted end-to-end harness. Enabled by env vars so it exercises the *real*
// main process (real IPC, real PtyManager) against the real renderer:
//   UREGANT_SMOKE=1            -> basic shell + pane round-trip, screenshot, exit
//   UREGANT_PROFILE=<n>        -> spin up <n> AI panes + 1 shell for profiling
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runSmoke(win: BrowserWindow): Promise<void> {
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })

  const exec = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code)

  try {
    await wait(500)

    // Add a shell pane and two AI panes through the real store.
    await exec(`window.__ws.getState().addPane('shell')`)
    await wait(300)
    await exec(`window.__ws.getState().addPane('ai')`)
    await exec(`window.__ws.getState().addPane('ai')`)
    await wait(600)

    // Find the shell pane's ptyId (set once the pty spawns) and type a command.
    const ptyId = await exec<string | null>(`
      (() => {
        const panes = Object.values(window.__ws.getState().panes);
        const sh = panes.find(p => p.type === 'shell');
        return sh && sh.shell ? sh.shell.ptyId || null : null;
      })()
    `)
    console.log('SMOKE shell ptyId:', ptyId)

    if (ptyId) {
      const marker = 'hello_from_smoke_42'
      await exec(`window.api.writePty(${JSON.stringify(ptyId)}, 'echo ${marker}\\r\\n')`)
      await wait(1200)
      const termText = await exec<string>(`
        (document.querySelector('.shell-pane .xterm-rows')?.innerText || '')
      `)
      const sawEcho = termText.includes(marker)
      // The command itself echoes the marker; a real shell prints it again on its own line.
      const occurrences = termText.split(marker).length - 1
      console.log('SMOKE shell output occurrences of marker:', occurrences, '(>=1 means pty works)')
      if (!sawEcho) errors.push('shell output did not contain marker')
    } else {
      errors.push('shell ptyId was never set (pty did not spawn)')
    }

    const paneCount = await exec<number>(`Object.keys(window.__ws.getState().panes).length`)
    const windows = await exec<number>(`document.querySelectorAll('.mosaic-window').length`)
    console.log('SMOKE panes:', paneCount, 'mosaic-windows:', windows)

    const img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke.png'), img.toPNG())
    console.log('SMOKE screenshot bytes:', img.toPNG().length)

    if (errors.length) {
      console.log('SMOKE ERRORS:\n' + errors.join('\n'))
      app.exit(1)
    } else {
      console.log('SMOKE OK')
      app.exit(0)
    }
  } catch (e) {
    console.log('SMOKE EXCEPTION: ' + (e as Error).message)
    app.exit(3)
  }
}

/** Exercises the full AI streaming pipeline against a mock Ollama server. */
export async function runAiSmoke(win: BrowserWindow): Promise<void> {
  const http = await import('http')
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (process.env.UREGANT_VERBOSE) console.log('RENDERER', level, message)
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })
  const exec = async <T>(label: string, code: string): Promise<T> => {
    try {
      return await win.webContents.executeJavaScript(code)
    } catch (e) {
      throw new Error(`step "${label}": ${(e as Error).message}`)
    }
  }

  // Mock Ollama: /api/tags + streaming NDJSON /api/chat.
  const reply =
    'Here is the async/await refactor:\n\n```ts\nasync function load(id) {\n  const res = await fetch(`/api/${id}`)\n  return res.json()\n}\n```\n\nStreaming works.'
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/tags')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ models: [{ name: 'mockmodel' }] }))
      return
    }
    if (req.url?.startsWith('/api/chat')) {
      res.setHeader('content-type', 'application/x-ndjson')
      const words = reply.split(' ')
      let i = 0
      const tick = setInterval(() => {
        if (i < words.length) {
          res.write(JSON.stringify({ message: { content: words[i] + ' ' }, done: false }) + '\n')
          i++
        } else {
          clearInterval(tick)
          res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n')
        }
      }, 20)
      return
    }
    res.statusCode = 404
    res.end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}`

  try {
    await new Promise((r) => setTimeout(r, 500))
    await exec('patchSettings', `window.api.patchSettings({ ollamaBaseUrl: ${JSON.stringify(url)} })`)
    await new Promise((r) => setTimeout(r, 200))

    const paneId = await exec<string>(
      'addPane',
      `
      (() => {
        const id = window.__ws.getState().addPane('ai');
        const p = window.__ws.getState().panes[id];
        window.__ws.getState().updatePane(id, { ai: { ...p.ai, provider: 'ollama', model: 'mockmodel' } });
        return id;
      })()
    `
    )
    await new Promise((r) => setTimeout(r, 200))
    await exec(
      'sendChat',
      `window.__chat.sendChat(window.__ws.getState().panes[${JSON.stringify(paneId)}], 'hello mock'); true`
    )
    await new Promise((r) => setTimeout(r, 1500))

    const content = await exec<string>(
      'readContent',
      `
      (() => {
        const msgs = window.__ws.getState().panes[${JSON.stringify(paneId)}].ai.messages;
        const a = [...msgs].reverse().find(m => m.role === 'assistant');
        return a ? a.content : '';
      })()
    `
    )
    console.log('AISMOKE assistant content:', JSON.stringify(content))
    if (!content.includes('Streaming works')) errors.push('assistant did not receive streamed text')

    const img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke-ai.png'), img.toPNG())
    console.log('AISMOKE screenshot bytes:', img.toPNG().length)

    if (errors.length) {
      console.log('AISMOKE ERRORS:\n' + errors.join('\n'))
      app.exit(1)
    } else {
      console.log('AISMOKE OK')
      app.exit(0)
    }
  } catch (e) {
    console.log('AISMOKE EXCEPTION: ' + (e as Error).message)
    app.exit(3)
  } finally {
    server.close()
  }
}

/** Opens Settings, seeds a key + token preview, and captures EN + AR/RTL views. */
export async function runSettingsSmoke(win: BrowserWindow): Promise<void> {
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })
  const exec = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  try {
    await new Promise((r) => setTimeout(r, 500))
    await exec(`window.api.patchSettings({ providerKey: { provider: 'anthropic', key: 'sk-ant-demo-XYZ9' } })`)
    await exec(`window.api.patchSettings({ telegramToken: '123456:demo-token-abcd' })`)
    await new Promise((r) => setTimeout(r, 200))
    await exec(`window.__ui.getState().setShowSettings(true)`)
    await new Promise((r) => setTimeout(r, 400))

    let img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke-settings-en.png'), img.toPNG())
    console.log('SETSMOKE en screenshot bytes:', img.toPNG().length)

    await exec(`window.api.patchSettings({ language: 'ar' })`)
    await new Promise((r) => setTimeout(r, 400))
    img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke-settings-ar.png'), img.toPNG())
    console.log('SETSMOKE ar screenshot bytes:', img.toPNG().length)

    const keySet = await exec(`window.__ws ? true : true`)
    void keySet
    const publicView = await win.webContents.executeJavaScript(
      `(async () => { const s = await window.api.getSettings(); return JSON.stringify({ aKey: s.providers.anthropic.keySet, aPrev: s.providers.anthropic.keyPreview, tg: s.telegram.tokenSet, lang: s.language }); })()`
    )
    console.log('SETSMOKE public:', publicView)

    if (errors.length) {
      console.log('SETSMOKE ERRORS:\n' + errors.join('\n'))
      app.exit(1)
    } else {
      console.log('SETSMOKE OK')
      app.exit(0)
    }
  } catch (e) {
    console.log('SETSMOKE EXCEPTION: ' + (e as Error).message)
    app.exit(3)
  }
}

/** Links a pane to a chat, simulates an inbound Telegram message, verifies injection. */
export async function runTelegramSmoke(win: BrowserWindow): Promise<void> {
  const http = await import('http')
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (process.env.UREGANT_VERBOSE) console.log('RENDERER', level, message)
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })
  const exec = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code)

  const reply = 'Pong! Telegram inbound routed to this pane.'
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/tags')) {
      res.end(JSON.stringify({ models: [{ name: 'mockmodel' }] }))
      return
    }
    if (req.url?.startsWith('/api/chat')) {
      res.setHeader('content-type', 'application/x-ndjson')
      res.write(JSON.stringify({ message: { content: reply }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n')
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  try {
    await new Promise((r) => setTimeout(r, 500))
    await exec(`window.api.patchSettings({ ollamaBaseUrl: 'http://127.0.0.1:${port}' })`)

    const paneId = await exec<string>(`
      (() => {
        const id = window.__ws.getState().addPane('ai');
        const p = window.__ws.getState().panes[id];
        window.__ws.getState().updatePane(id, { ai: { ...p.ai, provider: 'ollama', model: 'mockmodel' } });
        return id;
      })()
    `)

    // Link the pane to chat 999 (both store + main bridge map).
    await exec(`
      window.api.linkPaneToTelegram(${JSON.stringify(paneId)}, '999');
      window.__ws.getState().updatePane(${JSON.stringify(paneId)}, { telegramChatId: '999' });
      true
    `)
    await new Promise((r) => setTimeout(r, 200))

    // Simulate an inbound Telegram message arriving for that chat.
    win.webContents.send(IPC.telegramInbound, {
      paneId,
      text: 'ping from telegram',
      chatId: '999'
    })
    await new Promise((r) => setTimeout(r, 1200))

    const result = await exec<{ user: string; assistant: string; linked: boolean }>(`
      (() => {
        const p = window.__ws.getState().panes[${JSON.stringify(paneId)}];
        const msgs = p.ai.messages;
        const user = msgs.find(m => m.role === 'user');
        const assistant = [...msgs].reverse().find(m => m.role === 'assistant');
        return { user: user ? user.content : '', assistant: assistant ? assistant.content : '', linked: !!p.telegramChatId };
      })()
    `)
    console.log('TGSMOKE result:', JSON.stringify(result))
    if (result.user !== 'ping from telegram') errors.push('inbound message not injected as user prompt')
    if (!result.assistant.includes('Pong')) errors.push('assistant did not respond to inbound')
    if (!result.linked) errors.push('pane not linked')

    const img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke-telegram.png'), img.toPNG())
    console.log('TGSMOKE screenshot bytes:', img.toPNG().length)

    if (errors.length) {
      console.log('TGSMOKE ERRORS:\n' + errors.join('\n'))
      app.exit(1)
    } else {
      console.log('TGSMOKE OK')
      app.exit(0)
    }
  } catch (e) {
    console.log('TGSMOKE EXCEPTION: ' + (e as Error).message)
    app.exit(3)
  } finally {
    server.close()
  }
}

export async function runProfile(win: BrowserWindow, count: number): Promise<void> {
  const http = await import('http')
  const exec = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code)
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })

  // Mock server that streams a long reply token-by-token, fast — to stress the
  // rAF-batched commit path with many simultaneous streams.
  const TOKENS = 400
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/tags')) {
      res.end(JSON.stringify({ models: [{ name: 'mockmodel' }] }))
      return
    }
    if (req.url?.startsWith('/api/chat')) {
      res.setHeader('content-type', 'application/x-ndjson')
      let i = 0
      const tick = setInterval(() => {
        if (i < TOKENS) {
          res.write(JSON.stringify({ message: { content: `tok${i} ` }, done: false }) + '\n')
          i++
        } else {
          clearInterval(tick)
          res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n')
        }
      }, 5)
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port

  try {
    await new Promise((r) => setTimeout(r, 500))
    // clean, deterministic UI state for the profiling screenshot
    await exec(`window.api.patchSettings({ language: 'en', ollamaBaseUrl: 'http://127.0.0.1:${port}' })`)
    await exec(`window.__ws.getState().addPane('shell')`)
    for (let i = 0; i < count; i++) {
      await exec(`
        (() => {
          const id = window.__ws.getState().addPane('ai');
          const p = window.__ws.getState().panes[id];
          window.__ws.getState().updatePane(id, { ai: { ...p.ai, provider: 'ollama', model: 'mockmodel' } });
        })()
      `)
    }
    await new Promise((r) => setTimeout(r, 400))
    const memBefore = process.memoryUsage().rss / 1024 / 1024

    // Fire a stream into every AI pane at once.
    await exec(`
      (() => {
        const panes = Object.values(window.__ws.getState().panes).filter(p => p.type === 'ai');
        panes.forEach(p => window.__chat.sendChat(p, 'stress test, stream a lot'));
        return panes.length;
      })()
    `)

    // Let them stream concurrently.
    await new Promise((r) => setTimeout(r, 3500))
    const memAfter = process.memoryUsage().rss / 1024 / 1024

    const stats = await exec<{ panes: number; streaming: number; totalChars: number }>(`
      (() => {
        const ps = Object.values(window.__ws.getState().panes);
        const ai = ps.filter(p => p.type === 'ai');
        const streaming = ai.filter(p => p.ai.activeStreamId).length;
        const totalChars = ai.reduce((n, p) => n + p.ai.messages.reduce((a, m) => a + m.content.length, 0), 0);
        return { panes: ps.length, streaming, totalChars };
      })()
    `)
    console.log('PROFILE stats:', JSON.stringify(stats))
    console.log(`PROFILE mainRSS before=${memBefore.toFixed(1)}MB after=${memAfter.toFixed(1)}MB`)

    const img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke-profile.png'), img.toPNG())
    console.log('PROFILE screenshot bytes:', img.toPNG().length)

    if (errors.length) {
      console.log('PROFILE ERRORS:\n' + errors.join('\n'))
      app.exit(1)
    } else {
      console.log('PROFILE OK')
      app.exit(0)
    }
  } catch (e) {
    console.log('PROFILE EXCEPTION: ' + (e as Error).message)
    app.exit(3)
  } finally {
    server.close()
  }
}
