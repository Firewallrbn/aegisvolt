// Mapa estilo "satélite apagado": imagen Esri desaturada + relieve oscuro + vías principales en blanco (OpenFreeMap).
// Sin API keys. Cada estación es un marcador de vidrio con el color de su estado.
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { STATION_INFO, type Station } from './api';

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Imagen © Esri, Maxar, Earthstar Geographics',
    },
    relief: {
      type: 'raster', tileSize: 256, maxzoom: 16,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}'],
    },
    ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenFreeMap © OpenStreetMap' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b0b0b' } },
    { id: 'sat', type: 'raster', source: 'sat', paint: {
      'raster-saturation': -0.42, 'raster-brightness-max': 0.66, 'raster-contrast': 0.2 } },
    { id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-opacity': 0.32 } },
    { id: 'roads-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.12, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.6] } },
    { id: 'roads-major', type: 'line', source: 'ofm', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#f2f2f2', 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 3.2] } },
  ],
};

export const HOME = { center: [-74.093, 4.664] as [number, number], zoom: 11.6, pitch: 42, bearing: -12 };

// Estado de una estación: el peor de sus conectores (falla > ocupado > libre)
export function stationState(s: Station): 'available' | 'busy' | 'fault' {
  if (s.connectors.some((c) => c.status === 'FAULT')) return 'fault';
  return s.connectors.some((c) => c.status === 'AVAILABLE') ? 'available' : 'busy';
}

export function MapView({ stations, selected, onSelect, mapRef }: {
  stations: Station[]; selected: string | null; onSelect: (id: string) => void;
  mapRef: React.RefObject<maplibregl.Map | null>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; node: HTMLButtonElement }>());

  useEffect(() => {
    const map = new maplibregl.Map({ container: el.current!, style: STYLE, ...HOME, attributionControl: { compact: true } });
    mapRef.current = map;
    // los paneles flotantes tapan la derecha y el título la parte de arriba: el centro visual se corre
    if (innerWidth > 720) map.setPadding({ top: 150, right: 370, bottom: 40, left: 20 });
    else {
      const pts = Object.values(STATION_INFO).map((s) => s.lngLat);
      map.fitBounds(pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0])), { padding: 70, duration: 0 });
    }
    return () => { map.remove(); mapRef.current = null; markers.current.clear(); };
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const s of stations) {
      const info = STATION_INFO[s.id];
      if (!info) continue;
      let m = markers.current.get(s.id);
      if (!m) {
        const node = document.createElement('button');
        node.className = 'station-marker';
        node.addEventListener('click', () => onSelect(s.id));
        m = { node, marker: new maplibregl.Marker({ element: node }).setLngLat(info.lngLat).addTo(map) };
        markers.current.set(s.id, m);
      }
      const state = stationState(s);
      const free = s.connectors.filter((c) => c.status === 'AVAILABLE').length;
      m.node.dataset.state = state;
      m.node.classList.toggle('selected', s.id === selected);
      m.node.setAttribute('aria-label', `${info.name}: ${free} de ${s.connectors.length} conectores libres`);
      m.node.innerHTML = `<span class="ring"></span><span class="core">${free}/${s.connectors.length}</span><span class="name">${info.name}</span>`;
    }
  }, [stations, selected, onSelect, mapRef]);

  return <div ref={el} className="map" />;
}
