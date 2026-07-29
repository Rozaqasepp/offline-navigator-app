// src/components/OfflineTileLayer.ts
// Custom TileLayer yang memeriksa cache offline sebelum download dari internet.
// Memperbaiki memory leak dengan revoke ObjectURL setelah tile di-load.

import L from 'leaflet';
import localforage from 'localforage';

const tileStore = localforage.createInstance({
  name: 'OfflineMapCache',
  storeName: 'tiles'
});

const CustomLayer = L.TileLayer.extend({
  createTile: function (coords: L.Coords, done: (error: Error | undefined, tile: HTMLElement) => void) {
    const tile = document.createElement('img');
    const url = (this as L.TileLayer).getTileUrl(coords);

    // Revoke ObjectURL setelah gambar dimuat untuk mencegah memory leak
    const cleanup = (objectUrl: string | null) => {
      if (objectUrl) {
        tile.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
        tile.addEventListener('error', () => URL.revokeObjectURL(objectUrl), { once: true });
      }
    };

    tileStore.getItem<Blob>(url).then((blob) => {
      if (blob) {
        // Ada di cache offline
        const objectUrl = URL.createObjectURL(blob);
        cleanup(objectUrl);
        tile.src = objectUrl;
        done(undefined, tile);
      } else {
        // Tidak ada di cache, coba download (saat online)
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error('Offline');
            return res.blob();
          })
          .then(newBlob => {
            tileStore.setItem(url, newBlob); // Simpan untuk nanti (auto-cache)
            const objectUrl = URL.createObjectURL(newBlob);
            cleanup(objectUrl);
            tile.src = objectUrl;
            done(undefined, tile);
          })
          .catch(() => {
            // Jika offline dan belum di-cache, biarkan kosong
            tile.src = '';
            done(undefined, tile);
          });
      }
    }).catch(() => {
      // Fallback jika localforage error
      tile.crossOrigin = 'anonymous';
      tile.src = url;
      done(undefined, tile);
    });

    return tile;
  }
});

export const offlineTileLayer = (url: string, options?: L.TileLayerOptions) => {
  return new (CustomLayer as unknown as new (url: string, options?: L.TileLayerOptions) => L.TileLayer)(url, options);
};