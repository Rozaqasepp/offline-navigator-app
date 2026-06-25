// src/services/CacheService.ts
import localforage from 'localforage';

localforage.config({
  name: 'OfflineMapCache',
  storeName: 'tiles'
});

export const saveTile = async (url: string): Promise<void> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    await localforage.setItem(url, blob);
  } catch (err) {
    console.warn("Gagal cache tile:", url);
  }
};

export const getCachedTile = async (url: string): Promise<string | null> => {
  try {
    const blob = await localforage.getItem<Blob>(url);
    if (blob) {
      return URL.createObjectURL(blob);
    }
    return null;
  } catch (err) {
    return null;
  }
};

// Fungsi untuk membuat koordinat tile (Z, X, Y) di sekitar rute
export const cacheRouteTiles = async (routeGeoJSON: any, tileUrlTemplate: string) => {
  // Implementasi algoritma bounding box untuk menemukan X, Y pada zoom level tertentu (misal Z=15-18)
  // Untuk setiap X, Y, Z, hasilkan URL lalu panggil saveTile(url)
  // ... (Disimulasikan untuk ringkasnya)
};