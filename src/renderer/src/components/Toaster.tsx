import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useToasts, type ToastKind } from '@renderer/store/toasts'

function Icon({ kind }: { kind: ToastKind }): JSX.Element {
  if (kind === 'ok') return <CheckCircle2 size={15} />
  if (kind === 'error') return <AlertCircle size={15} />
  return <Info size={15} />
}

export default function Toaster(): JSX.Element {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)

  return (
    <div className="toaster">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <Icon kind={t.kind} />
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  )
}
