import { Check } from 'lucide-react'
import { useCopied } from '@renderer/store/copied'

/** Small transient "Copied" pill shown when terminal text is copied on selection. */
export default function CopiedFlash(): JSX.Element | null {
  const visible = useCopied((s) => s.visible)
  if (!visible) return null
  return (
    <div className="copied-flash" role="status">
      <Check size={13} />
      <span>Copied</span>
    </div>
  )
}
