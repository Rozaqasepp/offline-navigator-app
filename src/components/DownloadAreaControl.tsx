// src/components/DownloadAreaControl.tsx
// Komponen untuk mengelola unduhan area peta offline
// Menggunakan viewport peta saat ini sebagai area unduhan (intuitif di mobile)

import React, { useState, useEffect } from 'react';
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButton, IonIcon, IonList, IonItem, IonLabel, IonButtons,
  IonProgressBar, IonText
} from '@ionic/react';
import { downloadOutline, trashOutline, closeOutline } from 'ionicons/icons';
import {
  downloadTilesForArea, downloadRoadNetwork, saveDownloadedArea,
  getDownloadedAreas, deleteDownloadedArea, clearAllCache,
  getCacheStats, estimateTileCount,
  type DownloadArea, type DownloadProgress
} from '../services/OfflineDataService';
import { invalidatePathFinderCache } from '../services/OfflineRoutingService';

interface DownloadAreaControlProps {
  isOpen: boolean;
  onDismiss: () => void;
  getMapBounds: () => { south: number; west: number; north: number; east: number } | null;
  currentTileUrl: string;
  onToast: (msg: string) => void;
}

const MIN_ZOOM = 12;
const MAX_ZOOM = 16;

const DownloadAreaControl: React.FC<DownloadAreaControlProps> = ({
  isOpen, onDismiss, getMapBounds, currentTileUrl, onToast
}) => {
  const [areas, setAreas] = useState<DownloadArea[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [stats, setStats] = useState<{ tileCount: number; areaCount: number }>({ tileCount: 0, areaCount: 0 });
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [previewEstimate, setPreviewEstimate] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
      // Estimasi jumlah ubin untuk area yang terlihat
      const bounds = getMapBounds();
      if (bounds) {
        const est = estimateTileCount(bounds, MIN_ZOOM, MAX_ZOOM);
        setPreviewEstimate(est);
      }
    } else {
      setProgress(null);
    }
  }, [isOpen]);

  const loadData = async () => {
    const [loadedAreas, loadedStats] = await Promise.all([
      getDownloadedAreas(),
      getCacheStats()
    ]);
    setAreas(loadedAreas);
    setStats(loadedStats);
  };

  const handleDownload = async () => {
    const bounds = getMapBounds();
    if (!bounds) {
      onToast('Gagal mendapatkan area peta.');
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);
    setDownloading(true);
    setProgress({ phase: 'tiles', current: 0, total: 1, message: 'Memulai unduhan...' });

    try {
      // 1. Download ubin peta
      const tileCount = await downloadTilesForArea(
        bounds, currentTileUrl, MIN_ZOOM, MAX_ZOOM,
        (p) => setProgress(p),
        controller.signal
      );

      // 2. Download data jaringan jalan
      const roadNetwork = await downloadRoadNetwork(
        bounds,
        (p) => setProgress(p),
        controller.signal
      );

      // 3. Simpan metadata area
      await saveDownloadedArea(bounds, roadNetwork, tileCount);

      // 4. Reset cache routing agar PathFinder dimuat ulang
      invalidatePathFinderCache();

      setProgress({ phase: 'done', current: 1, total: 1, message: `Berhasil! ${tileCount} ubin + ${roadNetwork.features.length} ruas jalan tersimpan.` });
      onToast('Area berhasil diunduh! Anda bisa navigasi offline di area ini.');
      await loadData();
    } catch (err: any) {
      if (err.message === 'Download dibatalkan') {
        setProgress(null);
      } else {
        setProgress({
          phase: 'done', current: 0, total: 1,
          message: `Gagal: ${err.message}`
        });
      }
    } finally {
      setDownloading(false);
      setAbortController(null);
    }
  };

  const handleCancelDownload = () => {
    abortController?.abort();
    setDownloading(false);
    setProgress(null);
  };

  const handleDeleteArea = async (areaId: string) => {
    await deleteDownloadedArea(areaId);
    invalidatePathFinderCache();
    await loadData();
  };

  const handleClearAll = async () => {
    if (confirm('Hapus semua data offline? Tindakan ini tidak dapat dibatalkan.')) {
      await clearAllCache();
      invalidatePathFinderCache();
      await loadData();
      setProgress(null);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onDismiss} initialBreakpoint={0.65} breakpoints={[0, 0.65, 0.9]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Data Peta Offline</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onDismiss}><IonIcon icon={closeOutline} /></IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="download-modal-content">
        {/* Statistik */}
        <div className="download-stats">
          <div className="stat-card">
            <span className="stat-value">{stats.areaCount}</span>
            <span className="stat-label">Area</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.tileCount.toLocaleString('id-ID')}</span>
            <span className="stat-label">Ubin</span>
          </div>
        </div>

        {/* Tombol Download */}
        {!downloading && (
          <div className="download-actions">
            <div className="viewport-download-info">
              <IonText color="medium">
                <p className="download-hint">
                  Arahkan peta ke area yang ingin diunduh, lalu tekan tombol di bawah. 
                  Area yang terlihat di layar + data jalan akan disimpan untuk penggunaan offline.
                </p>
                {previewEstimate !== null && (
                  <p className="download-estimate">
                    Estimasi: ~{previewEstimate.toLocaleString('id-ID')} ubin peta
                  </p>
                )}
              </IonText>
            </div>
            <IonButton expand="block" className="download-btn" onClick={handleDownload}>
              <IonIcon slot="start" icon={downloadOutline} />
              Unduh Area yang Terlihat
            </IonButton>
          </div>
        )}

        {/* Progress Bar */}
        {progress && (
          <div className="download-progress">
            <p className="progress-message">{progress.message}</p>
            {progress.phase !== 'done' && (
              <>
                <IonProgressBar
                  value={progress.total > 0 ? progress.current / progress.total : 0}
                  color="primary"
                />
                <div className="progress-actions">
                  <IonButton size="small" color="danger" fill="outline" onClick={handleCancelDownload}>
                    Batalkan
                  </IonButton>
                </div>
              </>
            )}
          </div>
        )}

        {/* Daftar Area Tersimpan */}
        <div className="saved-areas-header">
          <h3>Area Tersimpan</h3>
          {areas.length > 0 && (
            <IonButton size="small" color="danger" fill="clear" onClick={handleClearAll}>
              Hapus Semua
            </IonButton>
          )}
        </div>

        <IonList className="saved-areas-list">
          {areas.length === 0 && (
            <IonItem lines="none">
              <IonLabel className="ion-text-center" color="medium">
                <p>Belum ada area yang diunduh.</p>
                <p style={{ fontSize: 12 }}>Arahkan peta ke area yang diinginkan, lalu tekan "Unduh Area yang Terlihat".</p>
              </IonLabel>
            </IonItem>
          )}
          {areas.map(area => (
            <IonItem key={area.id} className="area-item">
              <IonLabel>
                <h3>{area.name}</h3>
                <p>{area.tileCount.toLocaleString('id-ID')} ubin · {formatDate(area.downloadedAt)}</p>
              </IonLabel>
              <IonButton slot="end" fill="clear" color="danger" onClick={() => handleDeleteArea(area.id)}>
                <IonIcon icon={trashOutline} />
              </IonButton>
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonModal>
  );
};

export default DownloadAreaControl;
