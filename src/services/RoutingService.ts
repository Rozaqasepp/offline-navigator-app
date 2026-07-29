// src/services/RoutingService.ts
// Pencarian rute: online via OSRM, offline via geojson-path-finder

import { findOfflineRoute } from './OfflineRoutingService';

export interface RouteResult {
  geometry: { type: string; coordinates: number[][] };
  distance: number; // kilometer
  source: 'online' | 'offline';
}

/**
 * Cari rute dari OSRM (online)
 */
const getOnlineRoute = async (
  start: [number, number],
  end: [number, number]
): Promise<RouteResult> => {
  // OSRM menggunakan format: Longitude,Latitude
  const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;

  const response = await fetch(url);
  const data = await response.json();
  if (data.routes && data.routes.length > 0) {
    return {
      geometry: data.routes[0].geometry,
      distance: data.routes[0].distance / 1000, // meter → km
      source: 'online'
    };
  }
  throw new Error('Rute tidak ditemukan');
};

/**
 * Cari rute dengan fallback otomatis:
 * - Online → OSRM API (lebih akurat)
 * - Offline → geojson-path-finder (data lokal)
 */
export const getRoute = async (
  start: [number, number],
  end: [number, number]
): Promise<RouteResult> => {
  // Coba online dulu
  if (navigator.onLine) {
    try {
      return await getOnlineRoute(start, end);
    } catch (err) {
      console.warn('Gagal routing online, mencoba offline...', err);
    }
  }

  // Fallback ke offline
  const offlineResult = await findOfflineRoute(start, end);
  if (offlineResult) {
    return {
      geometry: offlineResult.geometry,
      distance: offlineResult.distance,
      source: 'offline'
    };
  }

  throw new Error('Tidak dapat menemukan rute. Pastikan Anda terhubung ke internet atau sudah mengunduh area peta.');
};