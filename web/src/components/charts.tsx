import { extent } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { fmt, shortYear } from "../lib/format";

export interface LineSeries {
  label: string;
  values: (number | null)[];
  color: string;
  dash?: boolean;
}

/** Petit graphique d'évolution (SVG responsive). */
export function LineChart({
  years,
  series,
  height = 120,
  width = 320,
  decimals = 0,
  unit = "",
  mark,
  title,
  refLine,
}: {
  years: string[];
  series: LineSeries[];
  height?: number;
  width?: number;
  decimals?: number;
  unit?: string;
  mark?: string;
  title: string;
  refLine?: { value: number; label: string };
}) {
  const m = { t: 10, r: 46, b: 20, l: 6 };
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (refLine) all.push(refLine.value);
  if (!all.length) return <p className="chart-empty">—</p>;
  const [lo, hi] = extent(all) as [number, number];
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  const x = scaleLinear().domain([0, years.length - 1]).range([m.l, width - m.r]);
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([height - m.b, m.t]);
  const mi = mark ? years.indexOf(mark) : -1;
  const first = years.findIndex((_, i) => series.some((s) => s.values[i] !== null));
  let last = -1;
  years.forEach((_, i) => series.some((s) => s.values[i] !== null) && (last = i));
  const gen = line<number | null>()
    .defined((v) => v !== null)
    .x((_, i) => x(i))
    .y((v) => y(v as number));
  const desc = series
    .map((s) => {
      const vals = s.values.map((v, i) => (v === null ? null : `${shortYear(years[i])} : ${fmt(v, decimals, unit)}`)).filter(Boolean);
      return `${s.label} — ${vals.join(", ")}`;
    })
    .join(". ");
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${desc}`} preserveAspectRatio="xMidYMid meet">
        {refLine && (
          <g className="chart-ref">
            <line x1={m.l} x2={width - m.r} y1={y(refLine.value)} y2={y(refLine.value)} />
            <text x={width - m.r + 4} y={y(refLine.value) + 3}>
              {refLine.label}
            </text>
          </g>
        )}
        {mi >= 0 && <line className="chart-mark" x1={x(mi)} x2={x(mi)} y1={m.t - 4} y2={height - m.b} />}
        {series.map((s) => (
          <g key={s.label}>
            <path d={gen(s.values) ?? ""} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dash ? "4 3" : undefined} />
            {s.values.map((v, i) => (v !== null && i === last ? <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill={s.color} /> : null))}
            {(() => {
              const v = s.values[last];
              return v !== null && v !== undefined ? (
                <text className="chart-end" x={x(last) + 6} y={y(v) + 3} fill={s.color}>
                  {fmt(v, decimals)}
                </text>
              ) : null;
            })()}
          </g>
        ))}
        {first >= 0 && (
          <text className="chart-axis" x={x(first)} y={height - 5}>
            {shortYear(years[first])}
          </text>
        )}
        {last > first && (
          <text className="chart-axis" x={x(last)} y={height - 5} textAnchor="end">
            {shortYear(years[last])}
          </text>
        )}
      </svg>
      {series.length > 1 && (
        <div className="chart-keys">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} className={s.dash ? "dash" : ""} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

/** Barres groupées (ex. erreur du modèle par pli de validation). */
export function GroupedBars({
  groups,
  series,
  height = 220,
  width = 560,
  decimals = 1,
  title,
  yLabel,
}: {
  groups: string[];
  series: { label: string; values: (number | null)[]; color: string }[];
  height?: number;
  width?: number;
  decimals?: number;
  title: string;
  yLabel: string;
}) {
  const m = { t: 12, r: 8, b: 28, l: 36 };
  const max = Math.max(...series.flatMap((s) => s.values.filter((v): v is number => v !== null)), 1);
  const x0 = scaleBand().domain(groups).range([m.l, width - m.r]).paddingInner(0.22);
  const x1 = scaleBand().domain(series.map((s) => s.label)).range([0, x0.bandwidth()]).padding(0.08);
  const y = scaleLinear().domain([0, max * 1.08]).nice().range([height - m.b, m.t]);
  const ticks = y.ticks(4);
  return (
    <figure className="chart chart--wide">
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} (${yLabel})`}>
        {ticks.map((tk) => (
          <g key={tk} className="chart-grid">
            <line x1={m.l} x2={width - m.r} y1={y(tk)} y2={y(tk)} />
            <text x={m.l - 6} y={y(tk) + 3} textAnchor="end">
              {fmt(tk, 0)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => (
          <g key={g} transform={`translate(${x0(g)},0)`}>
            {series.map((s) => {
              const v = s.values[gi];
              if (v === null) return null;
              return (
                <rect key={s.label} x={x1(s.label)} width={x1.bandwidth()} y={y(v)} height={y(0) - y(v)} fill={s.color}>
                  <title>{`${s.label}, ${g} : ${fmt(v, decimals)}`}</title>
                </rect>
              );
            })}
            <text className="chart-axis" x={x0.bandwidth() / 2} y={height - 9} textAnchor="middle">
              {g}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-keys">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Nuage de points observé / prédit avec diagonale. */
export function Scatter({
  points,
  title,
  xLabel,
  yLabel,
  max = 60,
  size = 260,
}: {
  points: { x: number; y: number; color: string }[];
  title: string;
  xLabel: string;
  yLabel: string;
  max?: number;
  size?: number;
}) {
  const m = { t: 8, r: 8, b: 30, l: 34 };
  const s = scaleLinear().domain([0, max]).range([0, size - m.l - m.r]);
  const ticks = s.ticks(4);
  return (
    <figure className="chart chart--square">
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title} : ${xLabel} en abscisse, ${yLabel} en ordonnée`}>
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks.map((tk) => (
            <g key={tk} className="chart-grid">
              <line x1={0} x2={s(max)} y1={s(max) - s(tk)} y2={s(max) - s(tk)} />
              <text x={-6} y={s(max) - s(tk) + 3} textAnchor="end">
                {tk}
              </text>
              <text x={s(tk)} y={s(max) + 14} textAnchor="middle">
                {tk}
              </text>
            </g>
          ))}
          <line className="chart-diag" x1={0} y1={s(max)} x2={s(max)} y2={0} />
          {points.map((p, i) => (
            <circle key={i} cx={s(Math.min(p.x, max))} cy={s(max) - s(Math.min(p.y, max))} r={2.4} fill={p.color} opacity={0.7} />
          ))}
          <text className="chart-axis" x={s(max) / 2} y={s(max) + 27} textAnchor="middle">
            {xLabel}
          </text>
        </g>
        <text className="chart-axis" transform={`translate(10,${size / 2}) rotate(-90)`} textAnchor="middle">
          {yLabel}
        </text>
      </svg>
    </figure>
  );
}

/** Ligne « valeur et intervalle » pour un classement. */
export function IntervalBar({ value, lo, hi, max, color, mark }: { value: number; lo: number; hi: number; max: number; color: string; mark?: number }) {
  const pc = (v: number) => `${(Math.max(0, Math.min(max, v)) / max) * 100}%`;
  return (
    <span className="interval" aria-hidden="true">
      <span className="interval-track" />
      {mark !== undefined && <span className="interval-mark" style={{ left: pc(mark) }} />}
      <span className="interval-range" style={{ left: pc(lo), width: `calc(${pc(hi)} - ${pc(lo)})`, background: color }} />
      <span className="interval-dot" style={{ left: pc(value), background: color }} />
    </span>
  );
}
