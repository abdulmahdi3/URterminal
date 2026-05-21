// Post-install helper that works around two Node-26-on-Windows breakages:
//   1. Electron's own installer uses extract-zip, which on Node 26 silently
//      extracts only one file. We re-extract the cached zip with PowerShell.
//   2. node-pty's prebuilt package install script spawns a .cmd shim without
//      shell:true, which throws EINVAL on Node 26. We invoke prebuild-install
//      directly via node.exe (spawning an .exe is fine) targeting the Electron
//      ABI instead of the local Node ABI.
//
// Safe to re-run: it no-ops when the binaries are already in place.

import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

function log(msg) {
  console.log(`[setup-natives] ${msg}`)
}

// ---------------------------------------------------------------------------
// 1. Electron binary
// ---------------------------------------------------------------------------
function ensureElectron() {
  const electronDir = join(root, 'node_modules', 'electron')
  if (!existsSync(electronDir)) {
    log('electron package not installed, skipping')
    return
  }
  const distDir = join(electronDir, 'dist')
  const exe = join(distDir, isWin ? 'electron.exe' : 'electron')
  if (existsSync(exe)) {
    log('electron binary already present')
    return
  }

  const version = require(join(electronDir, 'package.json')).version
  log(`electron binary missing, recovering v${version}`)

  // Trigger a download into the cache (extraction will likely fail; we redo it).
  try {
    execFileSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'ignore' })
  } catch {
    /* ignore — we only need the cached zip */
  }

  const cacheRoot =
    process.env.electron_config_cache ||
    join(process.env.LOCALAPPDATA || join(process.env.HOME || '', '.cache'), 'electron', 'Cache')

  const zip = findZip(cacheRoot, `electron-v${version}`)
  if (!zip) {
    throw new Error(`Could not find cached electron zip under ${cacheRoot}`)
  }

  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })

  if (isWin) {
    spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -Path "${zip}" -DestinationPath "${distDir}" -Force`],
      { stdio: 'inherit' }
    )
  } else {
    spawnSync('unzip', ['-o', zip, '-d', distDir], { stdio: 'inherit' })
  }

  writeFileSync(join(electronDir, 'path.txt'), isWin ? 'electron.exe' : 'electron')
  if (!existsSync(exe)) throw new Error('electron binary still missing after manual extraction')
  log('electron binary recovered')
}

function findZip(dir, prefix) {
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findZip(full, prefix)
      if (found) return found
    } else if (entry.name.startsWith(prefix) && entry.name.endsWith('.zip')) {
      return full
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 2. node-pty prebuilt binary for the Electron ABI
// ---------------------------------------------------------------------------
function ensureNodePty() {
  const pkgName = '@homebridge/node-pty-prebuilt-multiarch'
  let ptyDir
  try {
    ptyDir = dirname(require.resolve(`${pkgName}/package.json`))
  } catch {
    log('node-pty package not installed, skipping')
    return
  }

  const built = join(ptyDir, 'build', 'Release', 'pty.node')
  if (existsSync(built)) {
    log('node-pty binary already present')
    return
  }

  const electronVersion = require(join(root, 'node_modules', 'electron', 'package.json')).version
  const prebuildBin = require.resolve('prebuild-install/bin.js')
  log(`fetching node-pty prebuild for electron ${electronVersion}`)

  const res = spawnSync(
    process.execPath,
    [prebuildBin, '--runtime=electron', `--target=${electronVersion}`, `--arch=${process.arch}`, `--platform=${process.platform}`],
    { cwd: ptyDir, stdio: 'inherit' }
  )
  if (res.status !== 0 || !existsSync(built)) {
    throw new Error('Failed to fetch node-pty prebuild for the Electron ABI')
  }
  log('node-pty binary ready')
}

try {
  ensureElectron()
  ensureNodePty()
  log('done')
} catch (err) {
  console.error(`[setup-natives] ERROR: ${err.message}`)
  process.exit(1)
}
