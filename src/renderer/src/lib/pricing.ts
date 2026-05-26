// Rough cost estimation. The token counter only sees terminal *output* chars
// (≈ chars/4), so these are deliberately approximate per-agent output prices in
// USD per 1M tokens. Agents that use the user's own keys (aider/opencode) are
// left at 0 since their real model/price isn't known here.
export const AGENT_PRICE_PER_MTOK: Record<string, number> = {
  claude: 15,
  codex: 10,
  gemini: 5,
  aider: 0,
  opencode: 0
}

export function priceFor(command?: string): number {
  if (!command) return 0
  return AGENT_PRICE_PER_MTOK[command.toLowerCase()] ?? 0
}

/** Estimated USD cost for a token count produced by the given agent. */
export function costFor(tokens: number, command?: string): number {
  return (tokens / 1_000_000) * priceFor(command)
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}
