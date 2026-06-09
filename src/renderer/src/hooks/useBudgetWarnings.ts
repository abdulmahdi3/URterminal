import { useEffect, useRef } from 'react'
import { useTokens, formatTokens } from '@renderer/store/tokens'
import { useSettings } from '@renderer/store/settings'
import { toast } from '@renderer/store/toasts'

/**
 * Soft session-budget guardrail: watches cumulative token usage against the
 * `sessionTokenBudget` pref and fires a one-time toast at 80% and 100%. It never
 * blocks input — it's an advisory nudge so a long multi-agent session doesn't
 * quietly run up cost. Thresholds re-arm if the budget is changed/raised.
 */
export function useBudgetWarnings(): void {
  const budget = useSettings((s) => s.settings?.prefs.sessionTokenBudget ?? 0)
  // Which thresholds have already fired for the current budget value.
  const firedRef = useRef<{ budget: number; warn: boolean; over: boolean }>({
    budget: 0,
    warn: false,
    over: false
  })

  useEffect(() => {
    if (budget <= 0) return
    // Re-arm whenever the budget value changes.
    if (firedRef.current.budget !== budget) {
      firedRef.current = { budget, warn: false, over: false }
    }
    const unsub = useTokens.subscribe((s) => {
      const used = s.total
      const f = firedRef.current
      if (!f.over && used >= budget) {
        f.over = true
        f.warn = true
        toast(`Session budget reached — ${formatTokens(used)} / ${formatTokens(budget)} tokens`, 'error')
      } else if (!f.warn && used >= budget * 0.8) {
        f.warn = true
        toast(`80% of session token budget used (${formatTokens(used)} / ${formatTokens(budget)})`, 'info')
      }
    })
    return unsub
  }, [budget])
}
