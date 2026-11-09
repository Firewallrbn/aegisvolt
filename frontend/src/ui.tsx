// Piezas visuales reutilizables: números con decimales atenuados, estados con ícono, arte de línea y gráfica.
import { useState } from 'react';
import type { Saga } from './api';

// "78.3" -> "78." brillante + "3" atenuado, como en las tarjetas de referencia
export function Num({ value, decimals = 1, unit, className = '' }: { value: number; decimals?: number; unit?: string; className?: string }) {
  const [int, dec] = value.toFixed(decimals).split('.');
  return (
    <span className={`num ${className}`}>
      {Number(int).toLocaleString('es-CO')}{dec !== undefined && <>.<span className="dim">{dec}</span></>}
      {unit && <small>{unit}</small>}
    </span>
  );
}

const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'muted'; icon: string }> = {
  AVAILABLE: { label: 'Disponible', tone: 'good', icon: '✓' },
  RESERVED: { label: 'En uso', tone: 'warn', icon: '●' },
  FAULT: { label: 'Falla', tone: 'bad', icon: '!' },
  RUNNING: { label: 'En curso', tone: 'warn', icon: '…' },
  COMPLETED: { label: 'Cargando', tone: 'good', icon: '⚡' },
  FINISHED: { label: 'Finalizada', tone: 'muted', icon: '✓' },
  COMPENSATED: { label: 'Compensada', tone: 'warn', icon: '↺' },
  COMPENSATION_FAILED: { label: 'Compensación fallida', tone: 'bad', icon: '!' },
  DONE: { label: 'Hecho', tone: 'good', icon: '✓' },
  FAILED: { label: 'Falló', tone: 'bad', icon: '✕' },
};

export function Status({ value }: { value: string }) {
  const s = STATUS[value] ?? { label: value, tone: 'muted', icon: '·' };
  return <span className={`status ${s.tone}`}><i aria-hidden="true">{s.icon}</i>{s.label}</span>;
}

export function Van() {
  return (
    <svg className="lineart" viewBox="0 0 240 92" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round">
        <path d="M14 70V26q0-8 8-8h132q10 0 18 6l26 24q4 4 10 5l12 2q6 1 6 8v7q0 3-3 3h-14" />
        <path d="M14 70h22M74 70h96M208 70h0" />
        <path d="M156 24l22 22h-22z" /><path d="M150 24v46" /><path d="M24 26h118v28H24z" opacity=".55" />
        <path d="M60 26v28M100 26v28" opacity=".35" />
        <path d="M196 56h10" /><path d="M24 62h120" opacity=".3" />
        <circle cx="55" cy="72" r="13" /><circle cx="55" cy="72" r="6" /><circle cx="189" cy="72" r="13" /><circle cx="189" cy="72" r="6" />
        <path d="M118 36l-8 12h8l-6 10" strokeWidth="1.4" />
      </g>
    </svg>
  );
}

export function Charger() {
  return (
    <svg className="lineart" viewBox="0 0 64 96" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round">
        <rect x="10" y="6" width="30" height="80" rx="5" /><rect x="15" y="14" width="20" height="16" rx="2" />
        <path d="M26 36l-5 8h6l-4 8" strokeWidth="1.4" /><path d="M6 86h38" />
        <path d="M40 40q14 2 14 18v18q0 6-6 6" /><rect x="44" y="80" width="8" height="10" rx="2" />
      </g>
    </svg>
  );
}

// Tasa de éxito acumulada de las SAGAs, en orden cronológico. Una serie: sin leyenda; el título la nombra.
export function SuccessChart({ sagas }: { sagas: Saga[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ordered = [...sagas].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (ordered.length < 2) return <p className="empty">Aún no hay suficientes SAGAs para graficar.</p>;

  let ok = 0;
  const pts = ordered.map((s, i) => {
    if (s.status === 'COMPLETED' || s.status === 'FINISHED') ok++;
    return { saga: s, rate: (ok / (i + 1)) * 100 };
  });
  const W = 300, H = 96, pad = 4;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / 100) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join('');
  const h = hover !== null ? pts[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`Tasa de éxito acumulada: ${pts.at(-1)!.rate.toFixed(1)}% tras ${pts.length} SAGAs`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)));
        }}>
        {[25, 50, 75, 100].map((g) => <line key={g} className="grid" x1={0} x2={W} y1={y(g)} y2={y(g)} />)}
        <line className="target" x1={0} x2={W} y1={y(80)} y2={y(80)} />
        <path className="area" d={`${line}L${x(pts.length - 1)},${H}L${x(0)},${H}Z`} />
        <path className="series" d={line} />
        {pts.map((p, i) => p.saga.status.startsWith('COMPENSAT') &&
          <circle key={p.saga.id} className="mark-warn" cx={x(i)} cy={y(p.rate)} r={2.6} />)}
        {h && <>
          <line className="crosshair" x1={x(hover!)} x2={x(hover!)} y1={0} y2={H} />
          <circle className="mark-hover" cx={x(hover!)} cy={y(h.rate)} r={3.2} />
        </>}
      </svg>
      <div className="axis"><span>{new Date(ordered[0].createdAt).toLocaleDateString('es-CO')}</span><span>objetivo 80%</span><span>ahora</span></div>
      {h && (
        <div className="tooltip" style={{ left: `${(hover! / (pts.length - 1)) * 100}%` }}>
          <b>{h.rate.toFixed(1)}%</b> tras {hover! + 1} SAGAs<br />
          <Status value={h.saga.status} /> {h.saga.fleetId}
        </div>
      )}
    </div>
  );
}

export const shortId = (id: string) => id.slice(0, 8);
export const time = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
