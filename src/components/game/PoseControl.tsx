import { useEffect, useRef, useState } from 'react'
import { Slider } from '../ui/slider'

type Props = { label: string; value: number; min: number; max: number; step: number; unit: string; disabled: boolean; onCommit: (value: number) => void }
export function PoseControl({ label, value, min, max, step, unit, disabled, onCommit }: Props) {
  const [draft, setDraft] = useState(value)
  const skipBlurCommit = useRef(false)
  useEffect(() => setDraft(value), [value])
  const commit = (v: number) => {
    if (!Number.isFinite(v)) { setDraft(value); return }
    const next = Math.min(max, Math.max(min, v))
    setDraft(next)
    onCommit(next)
    setDraft(value)
  }
  return <div className="pose-control" data-disabled={disabled}>
    <div className="control-label">
      <label htmlFor={'control-' + label}>{label}</label>
      <div className="value-input">
        <input id={'control-' + label} aria-label={label} type="number" min={min} max={max} step={step}
          value={Number.isFinite(draft) ? draft : ''} disabled={disabled}
          onChange={(e) => setDraft(e.target.value === '' ? NaN : Number(e.target.value))}
          onBlur={() => { if (skipBlurCommit.current) { skipBlurCommit.current = false; return } commit(draft) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(draft); skipBlurCommit.current = true; e.currentTarget.blur() } if (e.key === 'Escape') { setDraft(value); skipBlurCommit.current = true; e.currentTarget.blur() } }} />
        <span>{unit}</span>
      </div>
    </div>
    <Slider aria-label={label + '滑块'} value={[Number.isFinite(draft) ? draft : value]}
      min={min} max={max} step={step} disabled={disabled}
      onValueChange={([v]) => setDraft(v)} onValueCommit={([v]) => commit(v)} />
  </div>
}

