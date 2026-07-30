/**
 * ToneGrid — banded rows against a continuous X axis, one mark per capture.
 *
 * Rows are amps ordered cleanest→heaviest (see `utils/ampHeaviness.ts`); X is a continuous measured
 * value (saturation). It is a **browser, not a morpher**: every mark is a real capture you can hover
 * to name and click to play. Nothing is interpolated, so everything you hear is a file on disk.
 *
 * Lives outside `Charts.tsx` on purpose — that module is pure presentational SVG with no
 * interaction, whereas this owns hover state, hit-testing and a rAF throttle.
 *
 * Overplotting: above `densityThreshold` marks, a row draws density cells instead of circles.
 * Jitter is deliberately NOT used — it invents positions the data doesn't have. Filtering is the
 * intended way to resolve a crowded row, which is what makes faceting feel like a payoff.
 */
import React from 'react'
import { makeScale, nearestPoint, niceTicks, type PlottedPoint } from './scales'

export interface ToneGridRow {
  key: string
  label: string
  /** Marked in the UI when there were too few measured captures to rank the row. */
  lowConfidence?: boolean
}

export interface ToneGridMark {
  id: string
  rowKey: string
  /** Value on the continuous axis (e.g. measured saturation). */
  x: number
  color: string
  label: string
}

interface DensityCell {
  rowKey: string
  px: number
  py: number
  w: number
  h: number
  opacity: number
  color: string
}

export const TONE_GRID_ROW_HEIGHT = 26
const PAD = { t: 10, r: 16, b: 30, l: 132 }

/** Height needed to show `rowCount` rows without scrolling. */
export function toneGridHeight(rowCount: number, rowHeight = TONE_GRID_ROW_HEIGHT): number {
  return PAD.t + Math.max(1, rowCount) * rowHeight + PAD.b
}

export function ToneGrid({
  rows,
  marks,
  xDomain,
  xLabel,
  width,
  height,
  rowHeight = TONE_GRID_ROW_HEIGHT,
  selectedId = null,
  hoveredId = null,
  densityThreshold = 140,
  densityBins = 60,
  onHoverChange,
  onSelect
}: {
  /** Cleanest first; rendered reversed so the heaviest row sits at the top. */
  rows: ToneGridRow[]
  marks: ToneGridMark[]
  xDomain: [number, number]
  xLabel: string
  width: number
  height: number
  rowHeight?: number
  selectedId?: string | null
  hoveredId?: string | null
  densityThreshold?: number
  densityBins?: number
  onHoverChange?: (mark: ToneGridMark | null, clientX: number, clientY: number) => void
  onSelect?: (mark: ToneGridMark) => void
}) {
  const plotW = Math.max(10, width - PAD.l - PAD.r)
  const plotH = Math.max(10, height - PAD.t - PAD.b)

  // Heaviest at top: reverse the cleanest-first ordering for display only.
  const displayRows = React.useMemo(() => [...rows].reverse(), [rows])

  const rowY = React.useMemo(() => {
    const map = new Map<string, number>()
    displayRows.forEach((row, i) => map.set(row.key, PAD.t + i * rowHeight + rowHeight / 2))
    return map
  }, [displayRows, rowHeight])

  const xScale = React.useMemo(
    () => makeScale(xDomain, [PAD.l, PAD.l + plotW]),
    [xDomain, plotW]
  )

  const { points, cells } = React.useMemo(() => {
    const byRow = new Map<string, ToneGridMark[]>()
    for (const mark of marks) {
      if (!rowY.has(mark.rowKey)) continue
      const list = byRow.get(mark.rowKey)
      if (list) list.push(mark)
      else byRow.set(mark.rowKey, [mark])
    }

    const pts: Array<ToneGridMark & PlottedPoint> = []
    const dense: DensityCell[] = []

    for (const [rowKey, rowMarks] of byRow) {
      const cy = rowY.get(rowKey)!

      if (rowMarks.length <= densityThreshold) {
        for (const mark of rowMarks) pts.push({ ...mark, px: xScale(mark.x), py: cy })
        continue
      }

      const binW = plotW / densityBins
      const buckets = new Map<number, { count: number; colors: Map<string, number> }>()
      for (const mark of rowMarks) {
        const frac = (xScale(mark.x) - PAD.l) / plotW
        const bin = Math.max(0, Math.min(densityBins - 1, Math.floor(frac * densityBins)))
        let bucket = buckets.get(bin)
        if (!bucket) {
          bucket = { count: 0, colors: new Map() }
          buckets.set(bin, bucket)
        }
        bucket.count++
        bucket.colors.set(mark.color, (bucket.colors.get(mark.color) ?? 0) + 1)
      }

      const maxCount = Math.max(...[...buckets.values()].map((b) => b.count), 1)
      for (const [bin, bucket] of buckets) {
        let color = '#6b7280'
        let top = -1
        for (const [candidate, n] of bucket.colors) {
          if (n > top) {
            top = n
            color = candidate
          }
        }
        dense.push({
          rowKey,
          px: PAD.l + bin * binW,
          py: cy - rowHeight * 0.34,
          w: Math.max(1, binW - 0.5),
          h: rowHeight * 0.68,
          // sqrt keeps sparse bins visible; a linear ramp made them vanish beside a peak.
          opacity: 0.15 + 0.85 * Math.sqrt(bucket.count / maxCount),
          color
        })
      }
    }
    return { points: pts, cells: dense }
  }, [marks, rowY, xScale, plotW, densityThreshold, densityBins, rowHeight])

  const overlayRef = React.useRef<SVGRectElement | null>(null)
  const rafRef = React.useRef<number | null>(null)

  /** Convert a mouse event to plot-space coords and find what is under it. */
  const hitAt = (clientX: number, clientY: number) => {
    const target = overlayRef.current
    if (!target) return null
    const box = target.getBoundingClientRect()
    // The overlay starts at (PAD.l, PAD.t), so add those back to get SVG-space coords.
    return nearestPoint(points, clientX - box.left + PAD.l, clientY - box.top + PAD.t)
  }

  const handleMove = (event: React.MouseEvent<SVGRectElement>) => {
    if (!onHoverChange) return
    const { clientX, clientY } = event
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      onHoverChange(hitAt(clientX, clientY), clientX, clientY)
    })
  }

  const handleClick = (event: React.MouseEvent<SVGRectElement>) => {
    if (!onSelect) return
    // Same hitAt as hover, so the highlighted mark is always the one you get.
    const hit = hitAt(event.clientX, event.clientY)
    if (hit) onSelect(hit)
  }

  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const xTicks = niceTicks(xDomain[0], xDomain[1], 5)

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* Row bands + labels */}
      {displayRows.map((row, i) => {
        const cy = rowY.get(row.key)!
        return (
          <g key={row.key}>
            {i % 2 === 1 && (
              <rect
                x={PAD.l}
                y={cy - rowHeight / 2}
                width={plotW}
                height={rowHeight}
                fill="currentColor"
                opacity={0.035}
              />
            )}
            <text
              x={PAD.l - 8}
              y={cy}
              textAnchor="end"
              dominantBaseline="middle"
              fill="currentColor"
              opacity={row.lowConfidence ? 0.42 : 0.7}
              fontSize="10.5"
            >
              {row.label.length > 20 ? `${row.label.slice(0, 19)}…` : row.label}
              {row.lowConfidence ? ' *' : ''}
            </text>
          </g>
        )
      })}

      {/* X grid + ticks */}
      {xTicks.map((tick) => (
        <g key={tick}>
          <line
            x1={xScale(tick)}
            y1={PAD.t}
            x2={xScale(tick)}
            y2={PAD.t + plotH}
            stroke="currentColor"
            opacity={0.08}
            strokeWidth="1"
            strokeDasharray="2 4"
          />
          <text
            x={xScale(tick)}
            y={PAD.t + plotH + 14}
            textAnchor="middle"
            fill="currentColor"
            opacity={0.45}
            fontSize="9.5"
          >
            {tick.toFixed(2)}
          </text>
        </g>
      ))}
      <text
        x={PAD.l + plotW / 2}
        y={height - 2}
        textAnchor="middle"
        fill="currentColor"
        opacity={0.45}
        fontSize="9.5"
      >
        {xLabel}
      </text>

      {/* Density cells for crowded rows */}
      {cells.map((cell, i) => (
        <rect
          key={`${cell.rowKey}-${i}`}
          x={cell.px}
          y={cell.py}
          width={cell.w}
          height={cell.h}
          fill={cell.color}
          opacity={cell.opacity}
          rx={1}
        />
      ))}

      {/* Individual marks */}
      {points.map((point) => {
        const isSelected = point.id === selectedId
        const isHovered = point.id === hoveredId
        return (
          <circle
            key={point.id}
            cx={point.px}
            cy={point.py}
            r={isSelected ? 5.5 : isHovered ? 4.5 : 3}
            fill={point.color}
            fillOpacity={isSelected || isHovered ? 1 : 0.6}
            stroke={isSelected ? 'currentColor' : 'none'}
            strokeWidth={isSelected ? 1.5 : 0}
          />
        )
      })}

      {/* One transparent hit surface, rather than a listener on every mark. */}
      <rect
        ref={overlayRef}
        x={PAD.l}
        y={PAD.t}
        width={plotW}
        height={plotH}
        fill="transparent"
        style={{ cursor: onSelect ? 'pointer' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverChange?.(null, 0, 0)}
        onClick={handleClick}
      />
    </svg>
  )
}
