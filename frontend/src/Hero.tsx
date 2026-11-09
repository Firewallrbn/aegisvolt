// Hero: estelas de luz tipo larga exposición (crema -> rojo) que se dibujan solas, con pulsos de "energía"
// recorriéndolas. A la derecha, una regla tipo obturador que elige el ambiente (dev / test / prod).
import { useEffect, useRef } from 'react';
import { ENVS, type Env } from './api';

type Pt = [number, number];
const LINES = 11;

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

// Cada estela sube desde abajo a la izquierda, se junta con las demás y se abre hacia abajo a la derecha
function paths(w: number, h: number): { main: Pt[]; tail: Pt[] }[] {
  return Array.from({ length: LINES }, (_, i) => {
    const t = i / (LINES - 1);
    const c: Pt = [w * (0.64 + 0.035 * t), h * (0.385 + 0.085 * t)];
    const a = bezier([w * (-0.04 + 0.66 * t), h * 1.04], [w * (0.2 + 0.44 * t), h * 0.68], [w * (0.45 + 0.14 * t), h * (0.4 + 0.07 * t)], c, 140);
    // la de más arriba en la curva es la exterior: termina más a la derecha, así las estelas no se cruzan
    const b = bezier(c, [w * (0.81 - 0.02 * t), h * (0.4 + 0.1 * t)], [w * (0.93 - 0.05 * t), h * (0.56 + 0.08 * t)], [w * (1.04 - 0.2 * t), h * 1.04], 120);
    const tail = bezier(c, [w * 0.56, h * (0.36 + 0.01 * t)], [w * 0.45, h * (0.3 + 0.006 * t)], [w * (0.33 + 0.015 * t), h * (0.27 + 0.006 * t)], 60);
    return { main: [...a, ...b.slice(1)], tail };
  });
}

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[], upto: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < upto; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function LightTrails() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, w = 0, h = 0, lines: ReturnType<typeof paths> = [];
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lines = paths(w, h);
    };

    const frame = (now: number) => {
      const elapsed = (now - start) / 1000;
      const draw = reduced ? 1 : Math.min(1, elapsed / 2.4);
      const ease = 1 - Math.pow(1 - draw, 3);
      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(w * 0.46, 0, w * 0.8, 0);
      grad.addColorStop(0, '#f4e7cf');
      grad.addColorStop(0.55, '#f0b896');
      grad.addColorStop(1, '#ff4f3f');
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      for (const [i, { main, tail }] of lines.entries()) {
        const upto = Math.max(2, Math.floor(main.length * Math.min(1, ease * 1.15 - i * 0.012)));
        ctx.strokeStyle = grad;
        // halo ancho y tenue + núcleo fino y brillante = brillo de larga exposición
        ctx.globalAlpha = 0.16; ctx.lineWidth = 7; stroke(ctx, main, upto);
        ctx.globalAlpha = 0.35; ctx.lineWidth = 3; stroke(ctx, main, upto);
        ctx.globalAlpha = 0.95; ctx.lineWidth = 1.3; stroke(ctx, main, upto);
        ctx.globalAlpha = 0.13 * ease; ctx.lineWidth = 0.8; stroke(ctx, tail, tail.length);

        if (!reduced && draw === 1) {
          // pulso de energía que recorre la estela
          const len = 26, pos = ((elapsed * 0.16 + i * 0.137) % 1) * (main.length + len);
          const from = Math.max(0, Math.floor(pos - len)), to = Math.min(main.length, Math.floor(pos));
          if (to - from > 1) {
            ctx.strokeStyle = '#fff6ea'; ctx.globalAlpha = 0.85; ctx.lineWidth = 2.2;
            stroke(ctx, main.slice(from, to), to - from);
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (!reduced) raf = requestAnimationFrame(frame);
    };

    resize();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => { resize(); if (reduced) frame(performance.now()); });
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="hero-canvas" aria-hidden="true" />;
}

// Regla tipo obturador: 19 marcas, las tres mayores son los ambientes
function EnvRuler({ env, onEnv, health }: { env: Env; onEnv: (e: Env) => void; health: Record<Env, boolean | null> }) {
  const majors: Record<number, Env> = { 3: 'dev', 9: 'test', 15: 'prod' };
  return (
    <div className="ruler" role="radiogroup" aria-label="Ambiente">
      <div className="ruler-head"><span>Ambiente</span><b>{env}</b></div>
      <div className="ruler-ticks">
        {Array.from({ length: 19 }, (_, i) => {
          const e = majors[i];
          return (
            <span key={i} className={`tick ${i % 3 === 0 ? 'mid' : ''} ${e ? 'major' : ''} ${e === env ? 'on' : ''}`} />
          );
        })}
      </div>
      <div className="ruler-labels">
        {ENVS.map((e, n) => (
          <button key={e} role="radio" aria-checked={e === env} className={e === env ? 'on' : ''} onClick={() => onEnv(e)}
            style={{ left: `${((n * 6 + 3) / 18) * 100}%` }}>
            {e}
            <i className={`dot ${health[e] === null ? '' : health[e] ? 'up' : 'down'}`} aria-label={health[e] ? 'en línea' : 'fuera de línea'} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Hero(props: { env: Env; onEnv: (e: Env) => void; health: Record<Env, boolean | null> }) {
  return (
    <section className="hero">
      <LightTrails />
      <div className="hero-copy">
        <h1>Carga la ciudad<br />con energía.</h1>
        <p>Reserva, cobro y activación de conectores de alta potencia para flotas eléctricas, en una sola transacción distribuida.</p>
        <div className="hero-cta">
          <a className="btn-primary" href="#consola">Abrir consola</a>
          <a className="btn-link" href="#historial">Ver historial <span aria-hidden="true">→</span></a>
        </div>
      </div>
      <EnvRuler {...props} />
    </section>
  );
}
