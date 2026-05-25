import { Bot, Terminal, ShieldCheck } from 'lucide-react'
import claudePng from '@renderer/assets/claude.png'
import chatgptPng from '@renderer/assets/chatgpt.png'
import geminiPng from '@renderer/assets/gemini.png'
import ubuntuPng from '@renderer/assets/ubuntu.png'
import linuxPng from '@renderer/assets/linux.png'
import powershellPng from '@renderer/assets/powershell.png'

/**
 * Small brand/identity icons so every pane shows what it's running.
 * Agents use their official logo images; shells use simplified marks.
 */

function BrandImg({
  src,
  size,
  invert
}: {
  src: string
  size: number
  /** invert a black logo to white for the dark UI (ChatGPT) */
  invert?: boolean
}): JSX.Element {
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className={invert ? 'brand-img brand-img-invert' : 'brand-img'}
    />
  )
}

/** Icon for an agent CLI by its command. */
export function AgentLogo({ command, size = 14 }: { command: string; size?: number }): JSX.Element {
  switch (command) {
    case 'claude':
      return <BrandImg src={claudePng} size={size} />
    case 'codex':
      return <BrandImg src={chatgptPng} size={size} invert />
    case 'gemini':
      return <BrandImg src={geminiPng} size={size} />
    default:
      return <Bot size={size} className="pane-icon ai" />
  }
}

/** The WSL distro name from a shell's args (e.g. ["-d","Ubuntu"] → "Ubuntu"). */
export function distroFromArgs(args?: string[]): string | null {
  if (!args) return null
  const i = args.indexOf('-d')
  return i >= 0 ? args[i + 1] ?? null : null
}

/** Icon for a shell by its binary + args (WSL distros get a distro logo). */
export function ShellLogo({
  shell,
  args,
  size = 14
}: {
  shell?: string
  args?: string[]
  size?: number
}): JSX.Element {
  const file = (shell ?? '').toLowerCase()
  if (file.includes('wsl')) {
    const distro = (distroFromArgs(args) ?? '').toLowerCase()
    if (distro.includes('ubuntu')) return <BrandImg src={ubuntuPng} size={size} />
    return <BrandImg src={linuxPng} size={size} />
  }
  // Elevated PowerShell (launched via "-Verb RunAs") → shield.
  if ((args ?? []).some((a) => /runas/i.test(a))) {
    return <ShieldCheck size={size} className="pane-icon shell" />
  }
  if (file.includes('powershell')) return <BrandImg src={powershellPng} size={size} />
  return <Terminal size={size} className="pane-icon shell" />
}
