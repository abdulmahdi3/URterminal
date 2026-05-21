import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@renderer/store/workspace'

export default function EmptyPane({ paneId }: { paneId: string }): JSX.Element {
  const { t } = useTranslation()
  const setPaneType = useWorkspace((s) => s.setPaneType)

  return (
    <div className="empty-pane">
      <div className="empty-pane-label">{t('pane.chooseType')}</div>
      <div className="empty-pane-actions">
        <button className="btn primary" onClick={() => setPaneType(paneId, 'ai')}>
          {t('pane.aiPane')}
        </button>
        <button className="btn" onClick={() => setPaneType(paneId, 'shell')}>
          {t('pane.shellPane')}
        </button>
      </div>
    </div>
  )
}
