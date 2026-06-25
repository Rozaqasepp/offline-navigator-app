// src/components/OfflineTileLayer.ts
import L from 'leaflet';
import localforage from 'localforage';

localforage.config({ name: 'OfflineMapCache', storeName: 'tiles' });

const CustomLayer = L.TileLayer.extend({
  createTile: function (coords: any, done: any) {
    const tile = document.createElement('img');
    const url = this.getTileUrl(coords);

    localforage.getItem<Blob>(url).then((blob) => {
      if (blob) {
        // File ada di memori offline HP
        tile.src = URL.createObjectURL(blob);
        done(null, tile);
      } else {
        // Tidak ada di memori, coba download (saat online)
        fetch(url)
          .then(res => {
             if (!res.ok) throw new Error("Offline");
             return res.blob();
          })
          .then(newBlob => {
            localforage.setItem(url, newBlob); // Simpan untuk nanti
            tile.src = URL.createObjectURL(newBlob);
            done(null, tile);
          })
          .catch(() => {
            // Jika offline dan belum di-cache, biarkan kosong
            done(null, tile);
          });
      }
    });

    return tile;
  }
});

export const offlineTileLayer = (url: string, options?: L.TileLayerOptions) => {
  return new (CustomLayer as any)(url, options) as L.TileLayer;
};