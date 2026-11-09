// Paneles de la consola: reserva (dispara la SAGA), compensaciones, flags, historial, telemetría y flotas.
import { Fragment, useEffect, useState } from 'react';
import {
  FLAG_INFO, FLEETS, PRICE_PER_KWH, STATION_INFO, SURGE, finishCharge, reserveAndCharge, setFlag, telemetry,
  type Env, type Flag, type Saga, type Station, type Telemetry, type Wallet,
} from './api';
import { Charger, Num, Status, Van, shortId, time } from './ui';

const STEPS = ['RESERVE', 'CHARGE', 'ACTIVATE'] as const;
const STEP_LABEL: Record<string, string> = { RESERVE: 'Reserva', CHARGE: 'Cobro', ACTIVATE: 'Activación' };

// Línea de tiempo de una SAGA: los pasos hacia adelante y, debajo, las compensaciones en orden inverso
export function SagaTimeline({ saga }: { saga: Saga }) {
  const forward = new Map(saga.steps.filter((s) => s.status === 'DONE' || s.status === 'FAILED').map((s) => [s.step, s]));
  const back = saga.steps.filter((s) => s.status.startsWith('COMPENSAT'));
  return (
    <div className="timeline">
      <ol className="forward">
        {STEPS.map((name) => {
          const s = forward.get(name);
          return (
            <li key={name} className={s ? s.status.toLowerCase() : 'pending'}>
              <span className="node" aria-hidden="true" />
              <b>{STEP_LABEL[name]}</b>
              {s ? <Status value={s.status} /> : <span className="muted">no ejecutado</span>}
            </li>
          );
        })}
      </ol>
      {back.length > 0 && (
        <ol className="backward" aria-label="Compensaciones">
          {back.map((s, i) => (
            <li key={i}><span aria-hidden="true">↺</span> {STEP_LABEL[s.step]} <Status value={s.status} /></li>
          ))}
        </ol>
      )}
      {saga.error && <p className="saga-error">{saga.error}</p>}
    </div>
  );
}

export function ReservePanel({ env, station, flags, onClose, onDone }: {
  env: Env; station: Station; flags: Flag[]; onClose: () => void; onDone: () => void;
}) {
  const info = STATION_INFO[station.id];
  const on = (n: string) => flags.find((f) => f.name === n)?.enabled === true;
  const boost = on('ENABLE_FAST_CHARGE_BOOST'), surge = on('ENABLE_DYNAMIC_SURGE_PRICING');
  const usable = (c: Station['connectors'][number]) => c.status === 'AVAILABLE' && (!c.ultra || boost);
  const [connectorId, setConnectorId] = useState(station.connectors.find(usable)?.id ?? '');
  const [fleetId, setFleetId] = useState(FLEETS[0]);
  const [kwh, setKwh] = useState(20);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Saga | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = kwh * PRICE_PER_KWH * (surge ? SURGE : 1);

  useEffect(() => { setResult(null); setError(null); setConnectorId(station.connectors.find(usable)?.id ?? ''); },
    [station.id]); // solo al cambiar de estación: el polling no debe borrar el resultado

  const submit = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await reserveAndCharge(env, { stationId: station.id, connectorId, fleetId, kwh }));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass reserve" role="dialog" aria-label={`Reservar en ${info?.name ?? station.id}`}>
      <header>
        <div><h3>{info?.name ?? station.id}</h3><p className="muted">{info?.area}</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
      </header>
      <Charger />
      <fieldset className="connectors">
        <legend>Conector</legend>
        {station.connectors.map((c) => {
          const locked = c.ultra && !boost;
          return (
            <label key={c.id} className={`connector ${connectorId === c.id ? 'on' : ''} ${usable(c) ? '' : 'off'}`}>
              <input type="radio" name="connector" value={c.id} checked={connectorId === c.id} disabled={!usable(c)}
                onChange={() => setConnectorId(c.id)} />
              <span className="cid">{c.id.toUpperCase()}</span>
              <span className="kw"><Num value={c.powerKw} decimals={0} unit="kW" /></span>
              {locked ? <span className="status bad"><i aria-hidden="true">🔒</i>Ultra apagada</span> : <Status value={c.status} />}
            </label>
          );
        })}
      </fieldset>
      <div className="row">
        <label className="field">Flota
          <select value={fleetId} onChange={(e) => setFleetId(e.target.value)}>
            {FLEETS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <label className="field">Energía <b>{kwh} kWh</b>
          <input type="range" min={5} max={60} step={5} value={kwh} onChange={(e) => setKwh(Number(e.target.value))} />
        </label>
      </div>
      <div className="quote">
        <span>Total estimado {surge && <em className="status warn"><i aria-hidden="true">↑</i>pico ×{SURGE}</em>}</span>
        <Num value={price} decimals={2} unit="cr" />
      </div>
      <button className="btn-primary wide" disabled={!connectorId || busy} onClick={submit}>
        {busy ? 'Ejecutando SAGA…' : 'Reservar y cargar'}
      </button>
      {error && <p className="saga-error" role="alert">{error}</p>}
      {result && (
        <div className="result" role="status">
          <div className="result-head"><span>SAGA {shortId(result.id)}</span><Status value={result.status} /></div>
          <SagaTimeline saga={result} />
        </div>
      )}
    </div>
  );
}

export function CompensationsPanel({ env, sagas }: { env: Env; sagas: Saga[] }) {
  const failed = sagas.filter((s) => s.status === 'COMPENSATED' || s.status === 'COMPENSATION_FAILED');
  const critical = failed.filter((s) => s.status === 'COMPENSATION_FAILED').length;
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="glass warnings" aria-label="Compensaciones">
      <header>
        <h3>Compensaciones</h3>
        <button className="icon-btn" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expandir' : 'Contraer'}>{collapsed ? '⌄' : '⌃'}</button>
      </header>
      {!collapsed && <>
        <p className="sub"><span aria-hidden="true">↺</span> SAGAs revertidas <span className="muted">({failed.length})</span>
          {critical > 0 && <span className="badge" aria-label={`${critical} con compensación fallida`}>{critical}</span>}</p>
        {failed.length === 0 && <p className="empty">Sin compensaciones en {env}.</p>}
        <ul>
          {failed.slice(0, 3).map((s) => (
            <li key={s.id} className={`incident ${s.status === 'COMPENSATION_FAILED' ? 'critical' : ''}`}>
              <button onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                <span className="badge-dot" aria-hidden="true">{s.status === 'COMPENSATION_FAILED' ? '!' : '↺'}</span>
                <span className="what">{s.error ?? 'Revertida'}<small>{s.fleetId} · {time(s.createdAt)}</small></span>
                <span aria-hidden="true">{open === s.id ? '⌃' : '⌄'}</span>
              </button>
              {open === s.id && (
                <div className="incident-body">
                  <SagaTimeline saga={s} />
                  <code title="Rastrear en CloudWatch">bash scripts/trace-saga.sh {env} {s.id}</code>
                </div>
              )}
            </li>
          ))}
        </ul>
        {failed.length > 3 && <p className="muted small">+{failed.length - 3} más en el historial</p>}
      </>}
    </section>
  );
}

export function FlagsPanel({ env, flags, onChange }: { env: Env; flags: Flag[]; onChange: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const toggle = async (f: Flag) => {
    setPending(f.name);
    try { await setFlag(env, f.name, !f.enabled); onChange(); } finally { setPending(null); }
  };
  return (
    <section className="glass flags" id="flags" aria-label={`Feature flags de ${env}`}>
      <header><h3>Feature flags</h3><span className="env-tag">{env}</span></header>
      <ul>
        {flags.map((f) => (
          <li key={f.name}>
            <div><b>{FLAG_INFO[f.name]?.label ?? f.name}</b><small>{FLAG_INFO[f.name]?.effect}</small><code>{f.name}</code></div>
            <button role="switch" aria-checked={f.enabled} className={`switch ${f.enabled ? 'on' : ''}`}
              disabled={pending === f.name} onClick={() => toggle(f)} aria-label={FLAG_INFO[f.name]?.label ?? f.name} />
          </li>
        ))}
      </ul>
      <p className="muted small">Se leen en cada petición: cambian el comportamiento sin redesplegar, solo en {env}.</p>
    </section>
  );
}

export function HistoryTable({ sagas }: { sagas: Saga[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="card history" id="historial" aria-label="Historial de SAGAs">
      <header>
        <h3>Historial de transacciones</h3>
        <span className="legend muted"><b>R</b> reserva · <b>C</b> cobro · <b>A</b> activación —
          <span className="step-chip done">✓</span> hecho <span className="step-chip comp">↺</span> compensado
          <span className="step-chip failed">✕</span> falló</span>
      </header>
      <div className="table-wrap">
        <table>
          <thead><tr><th>SAGA</th><th>Flota</th><th>Estación</th><th>kWh</th><th>Monto</th><th>Pasos</th><th>Estado</th><th>Hora</th></tr></thead>
          <tbody>
            {sagas.slice(0, 12).map((s) => {
              const st = new Map(s.steps.map((x) => [x.step + x.status, x]));
              return (
                <Fragment key={s.id}>
                  <tr onClick={() => setOpen(open === s.id ? null : s.id)} className={open === s.id ? 'open' : ''}>
                    <td><code>{shortId(s.id)}</code></td>
                    <td>{s.fleetId}</td>
                    <td>{STATION_INFO[s.stationId]?.name ?? s.stationId} · {s.connectorId}</td>
                    <td>{s.kwh}</td>
                    <td>{s.amount != null ? s.amount.toFixed(2) : '—'}</td>
                    <td className="steps">
                      {STEPS.map((n) => {
                        const v = st.has(n + 'DONE') ? (st.has(n + 'COMPENSATED') ? 'comp' : 'done') : st.has(n + 'FAILED') ? 'failed' : 'none';
                        return <span key={n} className={`step-chip ${v}`} title={`${STEP_LABEL[n]}: ${v}`}>{n[0]}</span>;
                      })}
                    </td>
                    <td><Status value={s.status} /></td>
                    <td className="muted">{time(s.createdAt)}</td>
                  </tr>
                  {open === s.id && <tr className="detail"><td colSpan={8}><SagaTimeline saga={s} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TelemetryCard({ env, sagas, onDone }: { env: Env; sagas: Saga[]; onDone: () => void }) {
  const active = sagas.filter((s) => s.status === 'COMPLETED');
  const [id, setId] = useState<string | null>(null);
  const current = active.find((s) => s.id === id) ?? active[0];
  const [t, setT] = useState<Telemetry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!current) { setT(null); return; }
    let live = true;
    const poll = () => telemetry(env, current.id).then((r) => live && setT(r), () => {});
    poll();
    const iv = setInterval(poll, 1500);
    return () => { live = false; clearInterval(iv); };
  }, [env, current?.id]);

  if (!current) {
    return (
      <section className="card telemetry" id="telemetria">
        <header><h3>Telemetría en vivo</h3></header>
        <p className="empty">No hay sesiones de carga activas en {env}. Reserva un conector en el mapa.</p>
      </section>
    );
  }
  const pct = t ? Math.min(100, (t.kwhDelivered / current.kwh) * 100) : 0;
  return (
    <section className="card telemetry" id="telemetria" aria-live="polite">
      <header>
        <h3>Telemetría en vivo</h3>
        {active.length > 1 && (
          <select value={current.id} onChange={(e) => setId(e.target.value)} aria-label="Sesión">
            {active.map((s) => <option key={s.id} value={s.id}>{shortId(s.id)} · {s.fleetId}</option>)}
          </select>
        )}
      </header>
      <div className="tele-main">
        <Num value={t?.kwhDelivered ?? 0} decimals={2} unit="kWh entregados" className="xl" />
        <p className="muted">{STATION_INFO[current.stationId]?.name} · {current.connectorId} · {current.fleetId}</p>
      </div>
      <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
        aria-label="Progreso de la carga"><span style={{ width: `${pct}%` }} /></div>
      <div className="tele-stats">
        <div><small>Potencia</small><Num value={t?.powerKw ?? 0} decimals={0} unit="kW" /></div>
        <div><small>Objetivo</small><Num value={current.kwh} decimals={0} unit="kWh" /></div>
        <div><small>Cobrado</small><Num value={current.amount ?? 0} decimals={2} unit="cr" /></div>
      </div>
      <button className="btn-ghost wide" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await finishCharge(env, current.id); onDone(); } finally { setBusy(false); }
      }}>{busy ? 'Finalizando…' : 'Finalizar carga y liberar conector'}</button>
    </section>
  );
}

export function FleetCard({ wallet, sagas }: { wallet: Wallet; sagas: Saga[] }) {
  const mine = sagas.filter((s) => s.fleetId === wallet.fleetId);
  const last = mine[0];
  const charging = mine.some((s) => s.status === 'COMPLETED');
  return (
    <article className="card fleet">
      <header>
        <div><h4>{wallet.fleetId}</h4><small className="muted">{last ? `Última SAGA ${time(last.createdAt)}` : 'Sin actividad'}</small></div>
        <span className={`pill ${charging ? 'live' : ''}`}>{charging ? '⚡ Cargando' : 'En ruta'}</span>
      </header>
      <Van />
      <footer>
        <div><small className="muted">Saldo</small><Num value={wallet.balance} decimals={2} unit="cr" /></div>
        <div><small className="muted">SAGAs</small><Num value={mine.length} decimals={0} /></div>
      </footer>
    </article>
  );
}
