'use client'

import { useId, useState } from 'react'
import { brl } from './ui'

export function RevenueChart({ points }: { points: { label: string; value: number }[] }) {
  const [selection, setSelection] = useState<number | null>(null)
  const id = useId()
  if (!points.length) return null
  const width = 600
  const height = 185
  const margin = 14
  const x = (index: number) => margin + index * (width - margin * 2) / Math.max(1, points.length - 1)
  const max = Math.max(1, ...points.map(point => point.value))
  const y = (value: number) => height - margin - value * (height - margin * 2) / max
  const line = points.map((point, index) => (index === 0 ? 'M' : 'L') + x(index) + ' ' + y(point.value)).join(' ')
  const area = line + ' L' + x(points.length - 1) + ' ' + (height - margin) + ' L' + margin + ' ' + (height - margin) + ' Z'
  const activeIndex = Math.min(Math.max(0, selection ?? points.length - 1), points.length - 1)
  const active = points[activeIndex]
  return <figure className="revenue-chart">
    <figcaption><time>{active.label}</time><strong>{brl(active.value)}</strong></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#a146f0" stopOpacity=".4" /><stop offset="100%" stopColor="#a146f0" stopOpacity=".06" />
      </linearGradient></defs>
      {[0, .25, .5, .75, 1].map(value => <line key={value} x1={margin} x2={width - margin} y1={y(value * max)} y2={y(value * max)} stroke="#e5d8f5" strokeDasharray="4 4" />)}
      <path d={area} fill={'url(#' + id + ')'} />
      <path d={line} fill="none" stroke="#751ed0" strokeWidth="3" strokeLinecap="round" />
      <circle cx={x(activeIndex)} cy={y(active.value)} r="5" fill="#fff" stroke="#751ed0" strokeWidth="3" />
    </svg>
    <div className="chart-dates"><span>{points[0].label}</span><span>{points.at(-1)?.label}</span></div>
    {points.length > 1 && <label>Explorar dias <input type="range" min={0} max={points.length - 1} value={activeIndex}
      aria-valuetext={active.label + ' · ' + brl(active.value)} onChange={event => setSelection(Number(event.target.value))} /></label>}
  </figure>
}
