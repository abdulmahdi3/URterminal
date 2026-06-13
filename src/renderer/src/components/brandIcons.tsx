import { Bot, Terminal, ShieldCheck } from 'lucide-react'
import claudePng from '@renderer/assets/claude.png'
import chatgptPng from '@renderer/assets/chatgpt.png'
import geminiPng from '@renderer/assets/gemini.png'
import aiderSvg from '@renderer/assets/aider.svg'
import opencodeSvg from '@renderer/assets/opencode.svg'
import copilotSvg from '@renderer/assets/copilot.svg'
import cursorSvg from '@renderer/assets/cursor.svg'
import clineSvg from '@renderer/assets/cline.svg'
import qwenSvg from '@renderer/assets/qwen.svg'
import amazonqSvg from '@renderer/assets/amazonq.svg'
import goosePng from '@renderer/assets/goose.png'
import openrouterSvg from '@renderer/assets/openrouter.svg'
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
  invert,
  wide
}: {
  src: string
  size: number
  /** invert a black logo to white for the dark UI (ChatGPT) */
  invert?: boolean
  /** a wide wordmark (e.g. Aider): keep its aspect ratio, only fix the height */
  wide?: boolean
}): JSX.Element {
  const cls = ['brand-img']
  if (invert) cls.push('brand-img-invert')
  if (wide) cls.push('brand-img-wide')
  return (
    <img
      src={src}
      width={wide ? undefined : size}
      height={size}
      alt=""
      draggable={false}
      className={cls.join(' ')}
    />
  )
}

interface Mark {
  src: string
  /** invert a black logo to white for the dark UI (ChatGPT) */
  invert?: boolean
  /** a wide wordmark (Aider) — keep its aspect ratio, fix only the height */
  wide?: boolean
}

/**
 * Official logo per agent CLI, keyed by the command spawned on PATH. The launch
 * console uses a few longer command ids (`cursor-agent`, `qwen-code`, `q`) so
 * those are aliased to the same mark as their short name.
 */
const AGENT_MARKS: Record<string, Mark> = {
  claude: { src: claudePng },
  codex: { src: chatgptPng, invert: true },
  gemini: { src: geminiPng },
  copilot: { src: copilotSvg },
  opencode: { src: opencodeSvg },
  aider: { src: aiderSvg, wide: true },
  cursor: { src: cursorSvg },
  'cursor-agent': { src: cursorSvg },
  cline: { src: clineSvg },
  goose: { src: goosePng },
  qwen: { src: qwenSvg },
  'qwen-code': { src: qwenSvg },
  q: { src: amazonqSvg },
  openrouter: { src: openrouterSvg }
}

/** Whether we have a real brand logo for an agent command (vs. the generic mark). */
export function hasAgentLogo(command: string | undefined): boolean {
  return !!command && command in AGENT_MARKS
}

/** Icon for an agent CLI by its command. */
export function AgentLogo({ command, size = 14 }: { command: string; size?: number }): JSX.Element {
  const mark = AGENT_MARKS[command]
  if (mark) return <BrandImg src={mark.src} size={size} invert={mark.invert} wide={mark.wide} />
  return <Bot size={size} className="pane-icon ai" />
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
