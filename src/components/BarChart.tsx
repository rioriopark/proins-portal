interface Datum {
  label: string
  value: number
}

export default function BarChart({ data, color = '#334155', height = 220 }: { data: Datum[]; color?: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const slot = 100 / Math.max(1, data.length)
  return (
    <svg viewBox={`0 0 100 ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const barH = (d.value / max) * (height - 40)
        const x = i * slot + slot * 0.15
        const w = slot * 0.7
        const y = height - 24 - barH
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={barH} fill={color} rx="1" />
            <text x={x + w / 2} y={height - 8} fontSize="3.2" textAnchor="middle" fill="#64748b">{d.label}</text>
            <text x={x + w / 2} y={y - 3} fontSize="3" textAnchor="middle" fill="#334155">
              {d.value > 0 ? d.value.toLocaleString('ko-KR') : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
