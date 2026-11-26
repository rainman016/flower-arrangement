import { AlertCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { useGameStore } from '../../state/game-store'

export default function RecoveryNotice({ onReset }: { onReset: () => void }) {
  const problem = useGameStore((s) => s.storageProblem)
  const raw = useGameStore((s) => s.originalRaw)
  if (!problem) return null
  const backup = () => {
    if (!raw) return
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = '一席花-原始进度备份.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="recovery-notice" role="alert">
    <AlertCircle size={19} />
    <p>{problem}</p>
    {raw ? <><Button variant="outline" onClick={backup}>下载原进度</Button><Button onClick={onReset}>重新开始</Button></>
      : <Button variant="outline" onClick={() => useGameStore.getState().retrySave()}>重试保存</Button>}
  </div>
}

