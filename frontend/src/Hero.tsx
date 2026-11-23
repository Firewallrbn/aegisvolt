// Hero: carretera Hyperspeed (React Bits, preset "split") de fondo, CardNav como navegación,
// titular con GradientText, regla tipo obturador para elegir el ambiente (dev / test / prod) y métricas en vivo.
import type { CSSProperties } from 'react';
import { ENVS, type Env } from './api';
import CardNav, { type CardNavItem } from './components/CardNav';
import GradientText from './components/GradientText';
import Hyperspeed, { type HyperspeedProps } from './components/Hyperspeed';
import SpecularButton from './components/SpecularButton';

export type HeroStats = { stations: number; connectors: number; free: number; sagas: number; rate: number; compensated: number };

// Paleta de la marca: turquesa (faros) + carmesí (luces traseras)
export const BRAND = { teal: '#53c2c6', tealSoft: '#a4e3e6', tealMid: '#80d1d4', crimson: '#d40652', red: '#b91010' };

const ROAD: HyperspeedProps = {
  tailColors: [BRAND.red, BRAND.crimson, BRAND.red],
  headColors: [BRAND.tealSoft, BRAND.tealMid, BRAND.teal],
  poleColors: [BRAND.tealSoft],
  roadColor: '#08080a',
  lineColor: '#25252d',
  curve: 'racing',
  curvature: 0.75,
  speed: 0.1,
  boost: 3.5,
  fov: 95,
  boostFov: 130,
  lanes: 2,
  roadWidth: 9,
  medianWidth: 5,
  density: 60,
  trailLength: 1.9,
  lightSize: 0.9,
  poles: 50,
  dust: 160,
  glow: 0.6,
  reflections: 0.35,
  roadOpacity: 0.35,
  steer: 0.2,
  interactive: false,
};

const NAV: CardNavItem[] = [
  {
    label: 'Operación',
    description: 'Estaciones, conectores y energía en tiempo real',
    bgColor: '#0f2426', textColor: BRAND.tealSoft,
    links: [
      { label: 'Mapa en vivo', href: '#consola' },
      { label: 'Telemetría', href: '#telemetria' },
    ],
  },
  {
    label: 'Transacciones',
    description: 'SAGA de reserva, cobro y activación',
    bgColor: '#2a0a17', textColor: '#ff9cbc',
    links: [
      { label: 'Historial', href: '#historial' },
      { label: 'Compensaciones', href: '#consola' },
    ],
  },
  {
    label: 'Plataforma',
    description: 'Feature flags por ambiente: dev, test y prod',
    links: [
      { label: 'Feature flags', href: '#flags' },
      { label: 'Ambientes', href: '#consola' },
    ],
  },
];

export function Logo({ className = 'logo' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <g strokeLinecap="round" strokeWidth="3.2" fill="none">
        <path d="M9 21 19 9" stroke={BRAND.tealSoft} /><path d="M13 24 23 12" stroke={BRAND.crimson} /><path d="M7 15 11 10" stroke="#5d6b6c" />
      </g>
    </svg>
  );
}

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

// Regla tipo obturador: 19 marcas, las tres mayores son los ambientes
function EnvRuler({ env, onEnv, health }: { env: Env; onEnv: (e: Env) => void; health: Record<Env, boolean | null> }) {
  const majors: Record<number, Env> = { 3: 'dev', 9: 'test', 15: 'prod' };
  return (
    <div className="ruler" role="radiogroup" aria-label="Ambiente">
      <div className="ruler-head"><span>Ambiente activo</span><b>{env}</b></div>
      <div className="ruler-ticks">
        {Array.from({ length: 19 }, (_, i) => {
          const e = majors[i];
          return <span key={i} className={`tick ${i % 3 === 0 ? 'mid' : ''} ${e ? 'major' : ''} ${e === env ? 'on' : ''}`} />;
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

export function Hero(props: { env: Env; onEnv: (e: Env) => void; health: Record<Env, boolean | null>; stats: HeroStats | null }) {
  const { stats } = props;
  const tiles = [
    { k: 'Estaciones', v: stats ? String(stats.stations) : '—', d: `${stats?.connectors ?? 0} conectores de alta potencia` },
    { k: 'Conectores libres', v: stats ? `${stats.free}/${stats.connectors}` : '—', d: 'disponibles para reservar ahora' },
    { k: 'SAGAs ejecutadas', v: stats ? String(stats.sagas) : '—', d: `${stats?.compensated ?? 0} compensadas con rollback` },
    { k: 'Tasa de éxito', v: stats ? `${stats.rate.toFixed(1)}%` : '—', d: 'objetivo > 80%' },
  ];

  return (
    <section className="hero">
      <div className="hero-road" aria-hidden="true"><Hyperspeed {...ROAD} /></div>
      <div className="hero-veil" aria-hidden="true" />

      <div className="hero-nav">
        <CardNav
          logo={<span className="brand"><Logo /><span>AegisVolt</span></span>}
          logoAlt="AegisVolt"
          items={NAV}
          cta={{ label: 'Abrir consola', href: '#consola' }}
          maxWidth={4000}
          ariaLabel="Secciones"
          style={{
            // barra casi negra y CTA en vidrio oscuro con borde turquesa (igual al "Abrir consola" del hero)
            '--cn-panel': 'rgba(8, 8, 11, 0.86)',
            '--cn-solid': '#08080b',
            '--cn-tile': 'linear-gradient(180deg, #17171c 0%, #111115 100%)',
            '--cn-cta': 'rgba(83, 194, 198, 0.08)',
            '--cn-cta-ink': '#e8f7f8',
            '--cn-cta-shadow': 'inset 0 0 0 1px rgba(83, 194, 198, 0.5), 0 0 18px -6px rgba(83, 194, 198, 0.5)',
            '--cn-cta-hover': 'brightness(1.35)',
          } as CSSProperties}
        />
      </div>

      <div className="hero-body">
        <div className="hero-copy">
          <h1>
            <span className="line">Carga de alta potencia</span>{' '}
            <span className="line">para{' '}
              <GradientText colors={[BRAND.tealSoft, BRAND.teal, BRAND.crimson, BRAND.red]} animationSpeed={6} className="hero-grad">
                flotas eléctricas.
              </GradientText>
            </span>
          </h1>
          <p>Reserva el conector, cobra a tu flota y activa la carga en un solo clic. Si un cargador falla, el dinero
            vuelve solo: cero vehículos varados, cero cobros perdidos.</p>
          <div className="hero-cta">
            <SpecularButton size="lg" radius={999} tint={BRAND.teal} tintOpacity={0.1} blur={10} textColor="#e8f7f8"
              lineColor={BRAND.tealSoft} baseColor="#3a3a44" idleIntensity={0.25} intensity={0.7} glow={0.5} proximity={140}
              onClick={() => go('consola')}>
              Abrir consola
            </SpecularButton>
            <SpecularButton size="lg" radius={999} tintOpacity={0.05} blur={10}
              lineColor={BRAND.crimson} baseColor="#3a3a44" idleIntensity={0.25} intensity={0.7} glow={0.5} proximity={140}
              onClick={() => go('historial')}>
              Ver historial <span aria-hidden="true">→</span>
            </SpecularButton>
          </div>
        </div>
        <EnvRuler {...props} />
      </div>

      <dl className="hero-stats">
        {tiles.map((t) => (
          <div key={t.k} className="hero-stat">
            <dt>{t.k}</dt>
            <dd><b>{t.v}</b><small>{t.d}</small></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
