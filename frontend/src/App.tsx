import type maplibregl from 'maplibre-gl';
import { useRef, useState } from 'react';
import { ENVS, STATION_INFO, type Env } from './api';
import { Hero } from './Hero';
import { HOME, MapView, stationState } from './MapView';
import { CompensationsPanel, FleetCard, FlagsPanel, HistoryTable, ReservePanel, TelemetryCard } from './panels';
import { Num, SuccessChart } from './ui';
import { useHealth, useSnapshot } from './useLive';

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-label="AegisVolt">
      <g strokeLinecap="round" strokeWidth="3.2" fill="none">
        <path d="M9 21 19 9" stroke="#f3e6cf" /><path d="M13 24 23 12" stroke="#ff5a45" /><path d="M7 15 11 10" stroke="#8a8a8a" />
      </g>
    </svg>
  );
}

export default function App() {
  const [env, setEnv] = useState<Env>(() => (ENVS as readonly string[]).includes(location.hash.slice(1)) ? location.hash.slice(1) as Env : 'dev');
  const health = useHealth();
  const { data, error, refresh } = useSnapshot(env);
  const [selected, setSelected] = useState<string | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const stations = data?.stations ?? [];
  const sagas = data?.sagas ?? [];
  const connectors = stations.flatMap((s) => s.connectors);
  const free = connectors.filter((c) => c.status === 'AVAILABLE').length;
  const done = sagas.filter((s) => s.status === 'COMPLETED' || s.status === 'FINISHED').length;
  const rate = sagas.length ? (done / sagas.length) * 100 : 0;
  const station = stations.find((s) => s.id === selected);

  const pick = (id: string) => {
    setSelected(id);
    const info = STATION_INFO[id];
    if (info) mapRef.current?.flyTo({ center: info.lngLat, zoom: 14.2, pitch: 55, duration: 1600, offset: [190, 60] }); // a la derecha del panel de reserva
  };
  const zoom = (d: number) => mapRef.current?.easeTo({ zoom: mapRef.current.getZoom() + d, duration: 300 });

  return (
    <>
      <Hero env={env} onEnv={setEnv} health={health} />

      <section className="console" id="consola">
        <nav className="topbar" aria-label="Consola">
          <Logo />
          <div className="tabs">
            <a className="on" href="#consola">Mapa en vivo</a>
            <a href="#flags">Flags</a>
            <a href="#historial">Transacciones</a>
            <a href="#telemetria">Telemetría</a>
          </div>
          <div className="env-switch" role="radiogroup" aria-label="Ambiente">
            {ENVS.map((e) => (
              <button key={e} role="radio" aria-checked={e === env} className={e === env ? 'on' : ''} onClick={() => setEnv(e)}>
                <i className={`dot ${health[e] === null ? '' : health[e] ? 'up' : 'down'}`} />{e}
              </button>
            ))}
          </div>
        </nav>

        <div className="console-grid">
          <aside className="left">
            <div className="chips">
              <span><b>{stations.length}</b> Estaciones</span>
              <span><b>{connectors.length}</b> Conectores</span>
              <span><b>{data?.wallets.length ?? 0}</b> Flotas</span>
            </div>
            <div className="stats">
              <div className="card stat"><span className="status good"><i aria-hidden="true">✓</i>Libres</span><Num value={free} decimals={0} className="lg" /></div>
              <div className="card stat"><span className="status warn"><i aria-hidden="true">●</i>En uso</span><Num value={connectors.length - free} decimals={0} className="lg" /></div>
            </div>
            <div className="card">
              <header><h3>Éxito de transacciones</h3><span className="muted">{sagas.length} SAGAs</span></header>
              <Num value={rate} decimals={1} unit="%" className="lg" />
              <p className="muted small">Objetivo: &gt;80% · los puntos ámbar son SAGAs compensadas</p>
              <SuccessChart sagas={sagas} />
            </div>
            <div className="fleets">
              {data?.wallets.map((w) => <FleetCard key={w.fleetId} wallet={w} sagas={sagas} />)}
            </div>
          </aside>

          <div className="stage">
            <MapView stations={stations} selected={selected} onSelect={pick} mapRef={mapRef} />
            <div className="stage-title">
              <h2>Gestión de Carga</h2>
              <div className="station-pills">
                {stations.map((s) => (
                  <button key={s.id} className={`pill ${s.id === selected ? 'on' : ''}`} onClick={() => pick(s.id)}>
                    <i className={`dot ${stationState(s) === 'available' ? 'up' : stationState(s) === 'fault' ? 'down' : 'warn'}`} />
                    {STATION_INFO[s.id]?.name ?? s.id}
                  </button>
                ))}
              </div>
            </div>
            <div className="map-controls">
              <button className="icon-btn round" onClick={() => zoom(1)} aria-label="Acercar">+</button>
              <button className="icon-btn round" onClick={() => { setSelected(null); mapRef.current?.flyTo({ ...HOME, duration: 1200 }); }} aria-label="Centrar">◎</button>
              <button className="icon-btn round" onClick={() => zoom(-1)} aria-label="Alejar">−</button>
            </div>
            <div className="stage-right">
              <CompensationsPanel env={env} sagas={sagas} />
              {data && <FlagsPanel env={env} flags={data.flags} onChange={refresh} />}
            </div>
            {station && data && (
              <ReservePanel env={env} station={station} flags={data.flags} onClose={() => setSelected(null)} onDone={refresh} />
            )}
            {error && !data && (
              <div className="glass offline" role="alert">
                <h3><span className="status bad"><i aria-hidden="true">!</i>{env} fuera de línea</span></h3>
                <p>{error}</p>
                <p className="muted small">Si el clúster de {env} está apagado, levántalo con <code>bash scripts/recover-eks.sh {env}</code>.</p>
              </div>
            )}
          </div>
        </div>

        <div className="bottom-grid">
          <HistoryTable sagas={sagas} />
          <TelemetryCard env={env} sagas={sagas} onDone={refresh} />
        </div>
      </section>
    </>
  );
}
