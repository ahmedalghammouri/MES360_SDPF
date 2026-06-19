'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import { Factory } from './factories';

interface SaudiMapProps {
  factories: Factory[];
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (factory: Factory) => void;
}

function markerHTML(factory: Factory): string {
  return `
    <div class="fpin" data-id="${factory.id}"
         style="--c:${factory.color};--g:${factory.glowColor}">
      <div class="fpin-ring"></div>
      <div class="fpin-dot"></div>
      <div class="fpin-label">${factory.code}</div>
    </div>`;
}

const CSS = `
  .fpin {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(.34,1.56,.64,1);
    transform-origin: center 70%;
  }
  .fpin:hover, .fpin.active { transform: scale(1.25); }

  .fpin-ring {
    position: absolute;
    top: 2px; left: 50%;
    transform: translateX(-50%);
    width: 32px; height: 32px;
    border-radius: 50%;
    background: var(--g);
    animation: fpulse 2.2s ease-in-out infinite;
    pointer-events: none;
  }
  .fpin.active .fpin-ring {
    width: 42px; height: 42px;
    top: -3px;
    animation-duration: 1.4s;
  }

  .fpin-dot {
    position: relative;
    z-index: 2;
    width: 14px; height: 14px;
    border-radius: 50%;
    background: var(--c);
    border: 2.5px solid rgba(255,255,255,0.95);
    box-shadow: 0 0 8px var(--c), 0 0 18px var(--g);
    transition: all 0.2s;
  }
  .fpin.active .fpin-dot {
    width: 20px; height: 20px;
    box-shadow: 0 0 14px var(--c), 0 0 30px var(--g), 0 0 50px var(--g);
  }

  .fpin-label {
    position: relative;
    z-index: 2;
    margin-top: 5px;
    font-size: 9px;
    font-weight: 800;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.06em;
    color: var(--c);
    text-shadow: 0 0 6px var(--c);
    background: rgba(0,4,18,0.88);
    border: 1px solid color-mix(in srgb, var(--c) 50%, transparent);
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
    transition: all 0.2s;
  }
  .fpin.active .fpin-label {
    font-size: 10px;
    padding: 2px 7px;
    background: rgba(0,4,18,0.95);
  }

  @keyframes fpulse {
    0%,100% { transform: translateX(-50%) scale(0.6); opacity: 0.6; }
    50%      { transform: translateX(-50%) scale(1.4); opacity: 0.15; }
  }

  /* ---- Leaflet dark overrides ---- */
  .leaflet-container { background: #060d1f !important; }
  .leaflet-tile-pane { filter: brightness(0.92) contrast(1.05); }

  .leaflet-control-zoom {
    border: 1px solid rgba(0,200,255,0.15) !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
    overflow: hidden;
    margin: 12px !important;
  }
  .leaflet-control-zoom a {
    background: rgba(4,10,28,0.92) !important;
    border-bottom: 1px solid rgba(0,200,255,0.1) !important;
    color: rgba(0,200,255,0.6) !important;
    width: 30px !important;
    height: 30px !important;
    line-height: 30px !important;
    font-size: 16px !important;
    font-weight: 300 !important;
    transition: all 0.15s;
  }
  .leaflet-control-zoom a:hover {
    background: rgba(0,200,255,0.12) !important;
    color: rgba(0,200,255,1) !important;
  }
  .leaflet-control-zoom-in { border-radius: 0 !important; }
  .leaflet-control-zoom-out { border-radius: 0 !important; border-bottom: none !important; }

  .leaflet-control-attribution {
    background: rgba(0,4,18,0.75) !important;
    color: rgba(255,255,255,0.25) !important;
    font-size: 9px !important;
    backdrop-filter: blur(4px);
    border-top-left-radius: 4px;
  }
  .leaflet-control-attribution a { color: rgba(255,255,255,0.35) !important; }
  .leaflet-attribution-flag { display: none !important; }
`;

export function SaudiMap({ factories, selectedId, hoveredId, onHover, onSelect }: SaudiMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  // Stable callback refs — Leaflet event listeners capture these once
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onHoverRef.current = onHover; }, [onHover]);

  // Update .active class on markers without recreating them
  const activeId = selectedId ?? hoveredId;
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const el = marker.getElement();
      const pin = el?.querySelector<HTMLElement>('.fpin');
      if (!pin) return;
      pin.classList.toggle('active', id === activeId);
    });
  }, [activeId]);

  // Initialize map once
  useEffect(() => {
    // Leaflet base CSS via CDN — avoids any SSR/build issues
    if (!document.getElementById('lf-css')) {
      const link = document.createElement('link');
      link.id = 'lf-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
    if (!document.getElementById('fpin-css')) {
      const style = document.createElement('style');
      style.id = 'fpin-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    let map: LeafletMap | null = null;

    import('leaflet').then((L) => {
      if (!containerRef.current || mapRef.current) return;

      map = L.map(containerRef.current, {
        zoomControl: false,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        attributionControl: true,
        minZoom: 5,
        maxZoom: 17,
      });

      // Zoom control at bottom-right
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // CartoDB Dark Matter — free, no API key required
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);

      // Default view: Saudi Arabia — markers fit the bounds once factories load
      map.setView([24.2, 45.0], 6);

      leafletRef.current = L;
      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      map?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      markersRef.current.clear();
      setMapReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync markers whenever the factory list changes (it loads async from the API)
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!mapReady || !map || !L) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    factories.forEach((factory) => {
      const icon = L.divIcon({
        html: markerHTML(factory),
        className: '',
        iconSize: [70, 58],
        iconAnchor: [35, 28],
      });

      const marker = L.marker([factory.lat, factory.lng], { icon, riseOnHover: true })
        .addTo(map)
        .on('click', () => onSelectRef.current(factory))
        .on('mouseover', () => onHoverRef.current(factory.id))
        .on('mouseout', () => onHoverRef.current(null));

      markersRef.current.set(factory.id, marker);
    });

    // Fit view to contain all markers — only when bounds are valid (≥1 point)
    if (factories.length > 0) {
      const bounds = L.latLngBounds(factories.map((f) => [f.lat, f.lng] as [number, number]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [55, 55], maxZoom: 7 });
    }
  }, [factories, mapReady]);

  return <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 0 }} />;
}
