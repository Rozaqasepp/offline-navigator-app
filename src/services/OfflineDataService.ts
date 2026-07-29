// src/services/OfflineDataService.ts
// Mengelola unduhan data peta offline: ubin peta + data jaringan jalan (GeoJSON)

import localforage from 'localforage';
import osmtogeojson from 'osmtogeojson';
import type { FeatureCollection } from 'geojson';

// Store terpisah untuk data jalan agar tidak tercampur dengan ubin peta
const roadStore = localforage.createInstance({
  name: 'OfflineMapCache',
  storeName: 'roads'
});

const tileStore = localforage.createInstance({
  name: 'OfflineMapCache',
  storeName: 'tiles'
});

const metaStore = localforage.createInstance({
  name: 'OfflineMapCache',
  storeName: 'meta'
});

export interface DownloadArea {
  id: string;
  name: string;
  bounds: { south: number; west: number; north: number; east: number };
  tileCount: number;
  downloadedAt: string;
}

export interface DownloadProgress {
  phase: 'tiles' | 'roads' | 'done';
  current: number;
  total: number;
  message: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;

// --- Fungsi konversi koordinat ke tile index ---
function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat: number, zoom: number): number {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
}

// --- Hitung jumlah ubin untuk estimasi ---
export function estimateTileCount(
  bounds: { south: number; west: number; north: number; east: number },
  minZoom: number,
  maxZoom: number
): number {
  let count = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lon2tile(bounds.west, z);
    const xMax = lon2tile(bounds.east, z);
    const yMin = lat2tile(bounds.north, z); // north = smaller y
    const yMax = lat2tile(bounds.south, z); // south = larger y
    count += (xMax - xMin + 1) * (yMax - yMin + 1);
  }
  return count;
}

// --- Download ubin peta massal ---
export async function downloadTilesForArea(
  bounds: { south: number; west: number; north: number; east: number },
  tileUrlTemplate: string,
  minZoom: number,
  maxZoom: number,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<number> {
  const tiles: { z: number; x: number; y: number }[] = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lon2tile(bounds.west, z);
    const xMax = lon2tile(bounds.east, z);
    const yMin = lat2tile(bounds.north, z);
    const yMax = lat2tile(bounds.south, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }

  const total = tiles.length;
  let downloaded = 0;
  const BATCH_SIZE = 6; // unduh 6 ubin paralel agar cepat tapi tidak throttle server

  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Download dibatalkan');

    const batch = tiles.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async ({ z, x, y }) => {
      const url = tileUrlTemplate
        .replace('{z}', z.toString())
        .replace('{x}', x.toString())
        .replace('{y}', y.toString())
        .replace('{s}', ['a', 'b', 'c'][Math.floor(Math.random() * 3)])
        .replace('{r}', '');

      try {
        // Cek apakah sudah ada di cache
        const existing = await tileStore.getItem(url);
        if (existing) {
          downloaded++;
          return;
        }

        const response = await fetch(url, { signal });
        if (!response.ok) return;
        const blob = await response.blob();
        await tileStore.setItem(url, blob);
        downloaded++;
      } catch {
        // Abaikan kegagalan tile individual
      }
    });

    await Promise.all(promises);

    onProgress({
      phase: 'tiles',
      current: downloaded,
      total,
      message: `Mengunduh ubin peta... ${downloaded}/${total}`
    });
  }

  return downloaded;
}

// --- Download data jaringan jalan dari Overpass API ---
export async function downloadRoadNetwork(
  bounds: { south: number; west: number; north: number; east: number },
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<FeatureCollection> {
  onProgress({
    phase: 'roads',
    current: 0,
    total: 1,
    message: 'Mengunduh data jaringan jalan...'
  });

  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const query = `
    [out:json][timeout:120];
    way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track"](${bbox});
    out body;
    >;
    out skel qt;
  `;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    signal
  });

  if (!response.ok) {
    throw new Error(`Gagal mengunduh data jalan: ${response.status}`);
  }

  const osmData = await response.json();

  console.log('[OfflineData] Overpass response elements:', osmData.elements?.length || 0);

  onProgress({
    phase: 'roads',
    current: 1,
    total: 1,
    message: 'Mengkonversi data jalan...'
  });

  // Konversi OSM → GeoJSON
  const geojson = osmtogeojson(osmData) as FeatureCollection;

  console.log('[OfflineData] GeoJSON features total:', geojson.features.length);

  // Filter hanya LineString (jalan), buang Point/Polygon
  const filtered: FeatureCollection = {
    type: 'FeatureCollection',
    features: geojson.features.filter(
      (f) => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'
    )
  };

  console.log('[OfflineData] LineString features:', filtered.features.length);

  if (filtered.features.length === 0) {
    throw new Error('Tidak ada data jalan di area ini. Coba area yang lebih luas.');
  }

  return filtered;
}

// --- Simpan area yang sudah diunduh ---
export async function saveDownloadedArea(
  bounds: { south: number; west: number; north: number; east: number },
  roadNetwork: FeatureCollection,
  tileCount: number
): Promise<DownloadArea> {
  const areaId = `area_${Date.now()}`;
  const area: DownloadArea = {
    id: areaId,
    name: `Area ${new Date().toLocaleDateString('id-ID')}`,
    bounds,
    tileCount,
    downloadedAt: new Date().toISOString()
  };

  // Simpan data jalan
  await roadStore.setItem(areaId, roadNetwork);

  // Simpan metadata area
  const areas = await getDownloadedAreas();
  areas.push(area);
  await metaStore.setItem('downloadedAreas', areas);

  return area;
}

// --- Muat semua area yang sudah diunduh ---
export async function getDownloadedAreas(): Promise<DownloadArea[]> {
  const areas = await metaStore.getItem<DownloadArea[]>('downloadedAreas');
  return areas || [];
}

// --- Muat data jalan dari area tertentu ---
export async function getRoadNetwork(areaId: string): Promise<FeatureCollection | null> {
  return await roadStore.getItem<FeatureCollection>(areaId);
}

// --- Muat SEMUA data jalan yang tersimpan (gabungan semua area) ---
export async function getAllRoadNetworks(): Promise<FeatureCollection> {
  const areas = await getDownloadedAreas();
  const allFeatures: FeatureCollection = {
    type: 'FeatureCollection',
    features: []
  };

  for (const area of areas) {
    const network = await roadStore.getItem<FeatureCollection>(area.id);
    if (network) {
      allFeatures.features.push(...network.features);
    }
  }

  return allFeatures;
}

// --- Hapus area tertentu ---
export async function deleteDownloadedArea(areaId: string): Promise<void> {
  await roadStore.removeItem(areaId);
  const areas = await getDownloadedAreas();
  const updated = areas.filter((a) => a.id !== areaId);
  await metaStore.setItem('downloadedAreas', updated);
}

// --- Statistik cache ---
export async function getCacheStats(): Promise<{ tileCount: number; areaCount: number }> {
  const tileCount = await tileStore.length();
  const areas = await getDownloadedAreas();
  return { tileCount, areaCount: areas.length };
}

// --- Hapus semua cache ---
export async function clearAllCache(): Promise<void> {
  await tileStore.clear();
  await roadStore.clear();
  await metaStore.clear();
}
