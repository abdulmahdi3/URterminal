// Headless smoke test: load the built renderer, surface console errors,
// drive a couple of store actions, and capture a screenshot to smoke.png.
const { app, BrowserWindow } = require('electron')
const { join } = require('path')

app.disableHardwareAcceleration()
const root = join(__dirname, '..')
const errors = []

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: join(root, 'out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true
    }
  })

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })
  win.webContents.on('render-process-gone', (_e, d) => {
    errors.push(`render-process-gone: ${d.reason}`)
  })

  await win.loadFile(join(root, 'out/renderer/index.html'))

  // give React a tick, then add panes via the exposed action (through the page)
  await win.webContents.executeJavaScript(`
    (async () => {
      await new Promise(r => setTimeout(r, 400));
      return document.querySelector('.toolbar') ? 'toolbar-present' : 'no-toolbar';
    })()
  `).then((r) => console.log('SMOKE dom:', r)).catch((e) => errors.push('exec: ' + e.message))

  // click the "Add AI pane" button twice + add shell, to exercise mosaic split
  await win.webContents.executeJavaScript(`
    (() => {
      const btns = [...document.querySelectorAll('button')];
      const ai = btns.find(b => b.textContent.includes('AI'));
      const sh = btns.find(b => b.textContent.includes('Shell') || b.textContent.includes('shell'));
      ai && ai.click();
      return new Promise(r => setTimeout(r, 150)).then(() => {
        const ai2 = [...document.querySelectorAll('button')].find(b => b.textContent.includes('AI pane') || b.textContent.includes('Add AI'));
        ai2 && ai2.click();
        const sh2 = [...document.querySelectorAll('button')].find(b => b.textContent.includes('shell') || b.textContent.includes('Shell'));
        sh2 && sh2.click();
        return new Promise(r => setTimeout(r, 250)).then(() => document.querySelectorAll('.mosaic-window').length);
      });
    })()
  `).then((n) => console.log('SMOKE mosaic-windows:', n)).catch((e) => errors.push('exec2: ' + e.message))

  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage()
  require('fs').writeFileSync(join(root, 'smoke.png'), img.toPNG())
  console.log('SMOKE screenshot bytes:', img.toPNG().length)

  if (errors.length) {
    console.log('SMOKE ERRORS:\n' + errors.join('\n'))
    app.exit(1)
  } else {
    console.log('SMOKE OK')
    app.exit(0)
  }
})
