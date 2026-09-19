"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEMO_MAP_CENTER, DEMO_MAP_ZOOM } from "@storm-leads/core";

type Storm = {
  id: string;
  event_type: string;
  geom: GeoJSON.Geometry;
  recent?: boolean;
  occurred_at?: string;
};

type Lead = {
  id: string;
  score: string | number;
  centroid: GeoJSON.Geometry | null;
};

export function StormMap({
  mapTilerKey,
  storms,
  selectedStormId,
  leads,
  selectedLeadId,
  onSelectLead,
}: {
  mapTilerKey: string;
  storms: Storm[];
  selectedStormId: string | null;
  leads: Lead[];
  selectedLeadId: string | null;
  onSelectLead: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelectLead);
  onSelectRef.current = onSelectLead;

  const stormFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: storms
        .filter((s) => s.geom)
        .map((s) => ({
          type: "Feature",
          geometry: s.geom,
          properties: {
            id: s.id,
            event_type: s.event_type,
            selected: s.id === selectedStormId,
            recent: Boolean(s.recent),
          },
        })),
    }),
    [storms, selectedStormId],
  );

  const leadFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: leads
        .filter((l) => l.centroid)
        .map((l) => ({
          type: "Feature",
          geometry: l.centroid as GeoJSON.Geometry,
          properties: {
            id: l.id,
            score: Number(l.score),
            selected: l.id === selectedLeadId,
          },
        })),
    }),
    [leads, selectedLeadId],
  );

  const stormFcRef = useRef(stormFc);
  const leadFcRef = useRef(leadFc);
  stormFcRef.current = stormFc;
  leadFcRef.current = leadFc;

  useEffect(() => {
    if (!ref.current || mapRef.current || !mapTilerKey) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${mapTilerKey}`,
      center: DEMO_MAP_CENTER,
      zoom: DEMO_MAP_ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("storms", { type: "geojson", data: stormFcRef.current });
      map.addSource("leads", { type: "geojson", data: leadFcRef.current });
      map.addLayer({
        id: "storm-fill",
        type: "fill",
        source: "storms",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#d4783b",
            ["==", ["get", "recent"], true],
            "#e2c08d",
            "#7ea8b8",
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "selected"], true],
            0.06,
            ["==", ["get", "recent"], true],
            0.04,
            0.015,
          ],
        },
      });
      map.addLayer({
        id: "storm-line",
        type: "line",
        source: "storms",
        paint: {
          "line-color": ["case", ["==", ["get", "recent"], true], "#d4783b", "#f3ece3"],
          "line-width": ["case", ["==", ["get", "recent"], true], 1.2, 0.8],
          "line-opacity": 0.4,
        },
      });
      map.addLayer({
        id: "lead-dots",
        type: "circle",
        source: "leads",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 7, 4],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "score"],
            0.2,
            "#7ea8b8",
            0.55,
            "#e2c08d",
            0.85,
            "#d4783b",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#161412",
        },
      });
      map.on("click", "lead-dots", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      map.on("mouseenter", "lead-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "lead-dots", () => {
        map.getCanvas().style.cursor = "";
      });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapTilerKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("storms")) return;
    (map.getSource("storms") as maplibregl.GeoJSONSource).setData(stormFc);
  }, [stormFc]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("leads")) return;
    (map.getSource("leads") as maplibregl.GeoJSONSource).setData(leadFc);
  }, [leadFc]);

  if (!mapTilerKey) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#b7aaa0]">
        Set NEXT_PUBLIC_MAPTILER_KEY to load the map.
      </div>
    );
  }

  return <div ref={ref} className="h-full w-full" />;
}
