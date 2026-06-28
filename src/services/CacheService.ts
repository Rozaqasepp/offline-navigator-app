// src/services/CacheService.ts
// Layanan caching ubin peta ke IndexedDB via localforage

import localforage from 'localforage';

const tileStore = localforage.createInstance({
  name: 'OfflineMapCache',
  storeName: 'tiles'
});

export const saveTile = async (url: string): Promise<void> => {
  try {
    const existing = await tileStore.getItem(url);
    if (existing) return; // Sudah ada, tidak perlu download ulang

    const response = await fetch(url);
    if (!response.ok) return;
    const blob = await response.blob();
    await tileStore.setItem(url, blob);
  } catch (err) {
    console.warn("Gagal cache tile:", url);
  }
};

export const getCachedTile = async (url: string): Promise<Blob | null> => {
  try {
    const blob = await tileStore.getItem<Blob>(url);
    return blob || null;
  } catch {
    return null;
  }
};

/**
 * Hitung jumlah ubin yang tersimpan di cache
 */
export const getTileCacheCount = async (): Promise<number> => {
  return await tileStore.length();
};

/**
 * Hapus seluruh cache ubin
 */
export const clearTileCache = async (): Promise<void> => {
  await tileStore.clear();
};