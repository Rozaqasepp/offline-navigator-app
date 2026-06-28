// src/services/OfflineRoutingService.ts
// Menghitung rute secara offline menggunakan geojson-path-finder

import PathFinder from 'geojson-path-finder';
import * as turf from '@turf/turf';
import { getAllRoadNetworks } from './OfflineDataService';
import type { FeatureCollection, Point, Feature, LineString } from 'geojson';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedPathFinder: any = null;
let cachedNetworkHash: string | null = null;

/**
 * Snap koordinat arbitrer ke vertex terdekat pada jaringan jalan.
 * geojson-path-finder membutuhkan titik yang tepat berada di vertex jaringan.
 */
function snapToNetwork(
  point: [number, number], // [lat, lng]
  network: FeatureCollection
): Feature<Point> | null {
  const pt = turf.point([point[1], point[0]]); // turf pakai [lng, lat]
  let nearestDist = Infinity;
  let nearestPoint: Feature<Point> | null = null;

  for (const feature of network.features) {
    if (feature.geometry.type !== 'LineString') continue;

    const coords = (feature.geometry as LineString).coordinates;
    for (const coord of coords) {
      const candidate = turf.point(coord);
      const dist = turf.distance(pt, candidate, { units: 'meters' });
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPoint = candidate;
      }
    }
  }

  // Jika titik terdekat lebih dari 500m, anggap tidak ada jalan terdekat
  if (nearestDist > 500) return null;

  return nearestPoint;
}

/**
 * Hitung hash sederhana dari network untuk invalidasi cache
 */
function networkHash(network: FeatureCollection): string {
  return `${network.features.length}_${network.features[0]?.geometry?.type || 'empty'}`;
}

/**
 * Hitung rute offline menggunakan data jaringan jalan yang tersimpan.
 *
 * @param start - Titik awal [lat, lng]
 * @param end - Titik tujuan [lat, lng]
 * @returns GeoJSON LineString geometry atau null jika tidak ditemukan
 */
export async function findOfflineRoute(
  start: [number, number],
  end: [number, number]
): Promise<{ geometry: { type: string; coordinates: number[][] }; distance: number } | null> {
  // 1. Muat semua data jaringan jalan yang tersimpan
  const network = await getAllRoadNetworks();

  if (!network.features.length) {
    throw new Error('Tidak ada data jalan offline. Silakan unduh area peta terlebih dahulu.');
  }

  // 2. Filter hanya LineString untuk PathFinder
  const lineStringNetwork: FeatureCollection<LineString> = {
    type: 'FeatureCollection',
    features: network.features.filter(
      (f): f is Feature<LineString> => f.geometry.type === 'LineString'
    )
  };

  // 3. Inisialisasi PathFinder (di-cache agar tidak buat ulang setiap kali)
  const hash = networkHash(lineStringNetwork);
  if (!cachedPathFinder || cachedNetworkHash !== hash) {
    cachedPathFinder = new PathFinder(lineStringNetwork, {
      precision: 0.00005 // ~5 meter akurasi
    } as any);
    cachedNetworkHash = hash;
  }

  // 4. Snap koordinat ke jaringan jalan
  const startSnapped = snapToNetwork(start, lineStringNetwork);
  const endSnapped = snapToNetwork(end, lineStringNetwork);

  if (!startSnapped) {
    throw new Error('Titik awal terlalu jauh dari jalan yang tersimpan.');
  }
  if (!endSnapped) {
    throw new Error('Titik tujuan terlalu jauh dari jalan yang tersimpan.');
  }

  // 5. Cari rute
  const path = cachedPathFinder.findPath(startSnapped, endSnapped);

  if (!path || !path.path || path.path.length === 0) {
    throw new Error('Rute offline tidak ditemukan. Pastikan area sudah diunduh sepenuhnya.');
  }

  // 6. Konversi hasil ke format yang kompatibel dengan Leaflet
  const coordinates: number[][] = path.path;

  // Hitung jarak total
  const line = turf.lineString(coordinates);
  const distance = turf.length(line, { units: 'kilometers' });

  return {
    geometry: {
      type: 'LineString',
      coordinates
    },
    distance
  };
}

/**
 * Cek apakah ada data jalan offline yang tersimpan
 */
export async function hasOfflineRoadData(): Promise<boolean> {
  const network = await getAllRoadNetworks();
  return network.features.length > 0;
}

/**
 * Reset cache PathFinder (panggil setelah download area baru)
 */
export function invalidatePathFinderCache(): void {
  cachedPathFinder = null;
  cachedNetworkHash = null;
}
