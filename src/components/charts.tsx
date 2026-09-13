import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import type { ReactNode } from 'react'
import { moneyShort, num, pct } from '../lib/format'

export const PALETTE = [
  '#e8913a', '#4aa8f0', '#35c07f', '#a583f0', '#f2545b',
  '#f5b544', '#41c9c9', '#d879b8', '#8fa4b8', '#7dd67d',
]

const axis = { stroke: 'var(--text-dim)', fontSize: 11, tickLine: false, axisLine: false }
const gridProps = { stroke: 'var(--border)', strokeDasharray: '3 3', vertical: false }

function TipBox({ label, rows }: { label?: ReactNode; rows: { name: string; value: ReactNode; color?: string }[] }) {
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
      borderRadius: 8, padding: '9px 11px', fontSize: 12, boxShadow: 'var(--shadow-lg)',
    }}>
      {label && <div style={{ fontWeight: 600, marginBottom: 5 }}>{label}</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            {r.color && <span className="dot" style={{ background: r.color }} />}
            {r.name}
          </span>
          <span className="num" style={{ fontWeight: 600 }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

type Fmt = (v: number) => string
const FMT: Record<string, Fmt> = {
  money: (v) => moneyShort(v),
  pct: (v) => pct(v),
  num: (v) => num(v),
}

function makeTooltip(format: keyof typeof FMT, labelKey?: string) {
  return function CustomTip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null
    return (
      <TipBox
        label={payload[0]?.payload?.[labelKey ?? '_label'] ?? label}
        rows={payload.map((p: any) => ({
          name: p.name, color: p.color ?? p.fill, value: FMT[format](p.value),
        }))}
      />
    )
  }
}

export function ChartFrame({ height = 220, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
    </div>
  )
}

export function TrendArea({
  data, xKey, series, height = 220, format = 'money', yWidth = 52,
}: {
  data: any[]; xKey: string; height?: number; format?: keyof typeof FMT; yWidth?: number
  series: { key: string; name: string; color?: string }[]
}) {
  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? PALETTE[i]} stopOpacity={0.4} />
              <stop offset="100%" stopColor={s.color ?? PALETTE[i]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axis} minTickGap={24} />
        <YAxis {...axis} width={yWidth} tickFormatter={FMT[format]} />
        <Tooltip content={makeTooltip(format)} />
        {series.map((s, i) => (
          <Area
            key={s.key} type="monotone" dataKey={s.key} name={s.name}
            stroke={s.color ?? PALETTE[i]} fill={`url(#g-${s.key})`} strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  )
}

export function TrendLine({
  data, xKey, series, height = 220, format = 'pct', reference,
}: {
  data: any[]; xKey: string; height?: number; format?: keyof typeof FMT
  series: { key: string; name: string; color?: string; dashed?: boolean }[]
  reference?: { y: number; label: string }
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axis} minTickGap={20} />
        <YAxis {...axis} width={48} tickFormatter={FMT[format]} />
        <Tooltip content={makeTooltip(format)} />
        {reference && (
          <ReferenceLine
            y={reference.y} stroke="var(--text-dim)" strokeDasharray="4 4"
            label={{ value: reference.label, fill: 'var(--text-dim)', fontSize: 10, position: 'right' }}
          />
        )}
        {series.map((s, i) => (
          <Line
            key={s.key} type="monotone" dataKey={s.key} name={s.name}
            stroke={s.color ?? PALETTE[i]} strokeWidth={2} dot={false}
            strokeDasharray={s.dashed ? '5 4' : undefined}
          />
        ))}
      </LineChart>
    </ChartFrame>
  )
}

export function Bars({
  data, xKey, series, height = 220, format = 'money', stacked, horizontal, onClick,
}: {
  data: any[]; xKey: string; height?: number; format?: keyof typeof FMT
  series: { key: string; name: string; color?: string }[]
  stacked?: boolean; horizontal?: boolean; onClick?: (row: any) => void
}) {
  return (
    <ChartFrame height={height}>
      <BarChart
        data={data} layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 6, right: 12, left: horizontal ? 8 : 0, bottom: 0 }}
        onClick={(e: any) => onClick?.(e?.activePayload?.[0]?.payload)}
      >
        <CartesianGrid {...gridProps} vertical={!!horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={FMT[format]} />
            <YAxis type="category" dataKey={xKey} {...axis} width={128} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axis} minTickGap={12} />
            <YAxis {...axis} width={52} tickFormatter={FMT[format]} />
          </>
        )}
        <Tooltip content={makeTooltip(format)} cursor={{ fill: 'var(--surface-2)' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key} dataKey={s.key} name={s.name} stackId={stacked ? 'a' : undefined}
            fill={s.color ?? PALETTE[i]} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            cursor={onClick ? 'pointer' : undefined}
          />
        ))}
      </BarChart>
    </ChartFrame>
  )
}

export function ColouredBars({
  data, xKey, valueKey, height = 260, format = 'money', horizontal = true, onClick,
}: {
  data: (any & { _color?: string })[]; xKey: string; valueKey: string; height?: number
  format?: keyof typeof FMT; horizontal?: boolean; onClick?: (row: any) => void
}) {
  return (
    <ChartFrame height={height}>
      <BarChart
        data={data} layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
        onClick={(e: any) => onClick?.(e?.activePayload?.[0]?.payload)}
      >
        <CartesianGrid {...gridProps} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={FMT[format]} />
            <YAxis type="category" dataKey={xKey} {...axis} width={140} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axis} />
            <YAxis {...axis} width={52} tickFormatter={FMT[format]} />
          </>
        )}
        <Tooltip content={makeTooltip(format)} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey={valueKey} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} cursor={onClick ? 'pointer' : undefined}>
          {data.map((d, i) => <Cell key={i} fill={d._color ?? PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

export function Donut({
  data, height = 210, format = 'money', onClick,
}: {
  data: { name: string; value: number; color?: string }[]
  height?: number; format?: keyof typeof FMT; onClick?: (row: any) => void
}) {
  return (
    <ChartFrame height={height}>
      <PieChart>
        <Pie
          data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="84%"
          paddingAngle={2} stroke="var(--surface)" strokeWidth={2}
          onClick={(e: any) => onClick?.(e?.payload)}
        >
          {data.map((d, i) => <Cell key={i} fill={d.color ?? PALETTE[i % PALETTE.length]} cursor={onClick ? 'pointer' : undefined} />)}
        </Pie>
        <Tooltip content={makeTooltip(format)} />
      </PieChart>
    </ChartFrame>
  )
}

export function ComboBarLine({
  data, xKey, bars, lines, height = 260, barFormat = 'money',
}: {
  data: any[]; xKey: string; height?: number; barFormat?: keyof typeof FMT
  bars: { key: string; name: string; color?: string; stackId?: string }[]
  lines: { key: string; name: string; color?: string }[]
}) {
  return (
    <ChartFrame height={height}>
      <ComposedChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axis} minTickGap={16} />
        <YAxis yAxisId="l" {...axis} width={52} tickFormatter={FMT[barFormat]} />
        <YAxis yAxisId="r" orientation="right" {...axis} width={44} tickFormatter={FMT.pct} />
        <Tooltip content={({ active, payload, label }: any) => {
          if (!active || !payload?.length) return null
          return (
            <TipBox label={label} rows={payload.map((p: any) => ({
              name: p.name, color: p.color ?? p.fill,
              value: lines.some((l) => l.key === p.dataKey) ? pct(p.value) : FMT[barFormat](p.value),
            }))} />
          )
        }} cursor={{ fill: 'var(--surface-2)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {bars.map((b, i) => (
          <Bar key={b.key} yAxisId="l" dataKey={b.key} name={b.name} stackId={b.stackId}
            fill={b.color ?? PALETTE[i]} radius={[3, 3, 0, 0]} />
        ))}
        {lines.map((l, i) => (
          <Line key={l.key} yAxisId="r" type="monotone" dataKey={l.key} name={l.name}
            stroke={l.color ?? PALETTE[(i + 4) % PALETTE.length]} strokeWidth={2.4} dot={{ r: 2.5 }} />
        ))}
      </ComposedChart>
    </ChartFrame>
  )
}

/** Menu-engineering matrix: popularity across, margin up. */
export function MenuMatrix({
  data, xLabel, yLabel, xRef, yRef, height = 340, onClick,
}: {
  data: { x: number; y: number; z: number; name: string; color: string }[]
  xLabel: string; yLabel: string; xRef: number; yRef: number; height?: number
  onClick?: (row: any) => void
}) {
  return (
    <ChartFrame height={height}>
      <ScatterChart margin={{ top: 12, right: 18, bottom: 18, left: 6 }}>
        <CartesianGrid {...gridProps} vertical />
        <XAxis
          type="number" dataKey="x" name={xLabel} {...axis}
          label={{ value: xLabel, position: 'insideBottom', offset: -10, fill: 'var(--text-dim)', fontSize: 11 }}
        />
        <YAxis
          type="number" dataKey="y" name={yLabel} {...axis} width={56}
          tickFormatter={(v: number) => moneyShort(v)}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: 'var(--text-dim)', fontSize: 11 }}
        />
        <ZAxis type="number" dataKey="z" range={[60, 520]} />
        <ReferenceLine x={xRef} stroke="var(--text-dim)" strokeDasharray="4 4" />
        <ReferenceLine y={yRef} stroke="var(--text-dim)" strokeDasharray="4 4" />
        <Tooltip content={({ active, payload }: any) => {
          if (!active || !payload?.length) return null
          const p = payload[0].payload
          return <TipBox label={p.name} rows={[
            { name: 'Sold', value: num(p.x) },
            { name: 'Margin / plate', value: moneyShort(p.y) },
            { name: 'Contribution', value: moneyShort(p.z) },
          ]} />
        }} />
        <Scatter data={data} onClick={(e: any) => onClick?.(e)}>
          {data.map((d, i) => <Cell key={i} fill={d.color} cursor={onClick ? 'pointer' : undefined} />)}
        </Scatter>
      </ScatterChart>
    </ChartFrame>
  )
}

export function Sparkline({
  data, color = 'var(--brand)', height = 32,
}: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / span) * 100}`).join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
