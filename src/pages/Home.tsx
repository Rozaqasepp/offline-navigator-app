import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  IonContent, IonPage, IonToast, IonIcon,
  IonModal, IonHeader, IonToolbar, IonTitle, IonList, IonItem,
  IonLabel, IonButtons, IonButton,
  useIonViewDidEnter
} from '@ionic/react';
import {
  layersOutline, trashOutline, navigateOutline,
  starOutline, star, listOutline, downloadOutline, closeOutline,
  locateOutline
} from 'ionicons/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { getRoute, type RouteResult } from '../services/RoutingService';
import { offlineTileLayer } from '../components/OfflineTileLayer';
import * as turf from '@turf/turf';
import NavigationPanel from '../components/NavigationPanel';
import StatusIndicator from '../components/StatusIndicator';
import DownloadAreaControl from '../components/DownloadAreaControl';
import './Home.css';

import markerIconPng from 'leaflet/dist/images/marker-icon.png';
import markerShadowPng from 'leaflet/dist/images/marker-shadow.png';

// Fix ikon default Leaflet
const defaultIcon = new L.Icon({
  iconUrl: markerIconPng,
  shadowUrl: markerShadowPng,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
L.Marker.prototype.options.icon = defaultIcon;

// === KONFIGURASI TEMA PETA ===
const MAP_STYLES = {
  OSM: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  Satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  Dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
} as const;

type ThemeKey = keyof typeof MAP_STYLES;
type FavoritePlace = { id: string; name: string; lat: number; lng: number };

const Home: React.FC = () => {
  // === REFS ===
  const mapRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const routeLayerRef = useRef<L.GeoJSON | null>(null);
  const routeDataRef = useRef<RouteResult | null>(null);
  const watchIdRef = useRef<string | null>(null);
  const isNavigatingRef = useRef(false);

  // === STATE ===
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [distanceLeft, setDistanceLeft] = useState('0');
  const [routeSource, setRouteSource] = useState<'online' | 'offline' | null>(null);
  const [currentTheme, setCurrentTheme] = useState<ThemeKey>(() => {
    return (localStorage.getItem('mapTheme') as ThemeKey) || 'OSM';
  });
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);

  // Status
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  // Favorit
  const [favorites, setFavorites] = useState<FavoritePlace[]>([]);
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);

  // Download Area
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  // Navigasi: kamera mengikuti pengguna
  const [followUser, setFollowUser] = useState(true);
  const followUserRef = useRef(true);

  // === LIFECYCLE ===
  useIonViewDidEnter(() => {
    if (mapRef.current) setTimeout(() => mapRef.current?.invalidateSize(), 100);
  });

  useEffect(() => {
    // 1. Double tap back button (Android)
    let lastTimeBackPress = 0;
    const backButtonListener = App.addListener('backButton', () => {
      const timeperiod = new Date().getTime() - lastTimeBackPress;
      if (timeperiod < 2000) {
        App.exitApp();
      } else {
        setToastMsg('Tekan sekali lagi untuk keluar aplikasi');
        lastTimeBackPress = new Date().getTime();
      }
    });

    // 2. Muat favorit
    const savedFavs = localStorage.getItem('favPlaces');
    if (savedFavs) setFavorites(JSON.parse(savedFavs));

    // 3. Inisialisasi peta
    if (!mapRef.current) {
      mapRef.current = L.map('mapId', { zoomControl: false }).setView([-2.5489, 118.0149], 5);

      // Terapkan tema tersimpan atau default (OSM/Terang)
      const savedTheme = (localStorage.getItem('mapTheme') as ThemeKey) || 'OSM';
      applyMapTheme(savedTheme);

      // Event klik peta → set tujuan
      mapRef.current.on('click', async (e: L.LeafletMouseEvent) => {
        if (isNavigatingRef.current) return;
        const dest: [number, number] = [e.latlng.lat, e.latlng.lng];
        handleSetDestination(dest);
      });

      // Deteksi user drag peta saat navigasi → matikan follow
      mapRef.current.on('dragstart', () => {
        if (isNavigatingRef.current) {
          followUserRef.current = false;
          setFollowUser(false);
        }
      });

      initGPS();

      // 4. Restore rute terakhir
      setTimeout(() => {
        const savedDest = localStorage.getItem('lastDest');
        const savedRoute = localStorage.getItem('lastRoute');
        if (savedDest && savedRoute) {
          try {
            const destCoords = JSON.parse(savedDest);
            const routeData = JSON.parse(savedRoute) as RouteResult;
            handleSetDestination(destCoords, routeData);
            setToastMsg('Memuat rute terakhir Anda...');
          } catch {
            localStorage.removeItem('lastDest');
            localStorage.removeItem('lastRoute');
          }
        }
      }, 1000);
    }

    // 5. Monitor status koneksi
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      backButtonListener.then(handle => handle.remove());
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // === FUNGSI PETA ===
  const applyMapTheme = useCallback((themeKey: ThemeKey) => {
    if (!mapRef.current) return;
    if (currentTileLayerRef.current) {
      mapRef.current.removeLayer(currentTileLayerRef.current);
    }
    currentTileLayerRef.current = offlineTileLayer(MAP_STYLES[themeKey], { maxZoom: 19 }).addTo(mapRef.current);
    setCurrentTheme(themeKey);
    localStorage.setItem('mapTheme', themeKey);
  }, []);

  const getMapBounds = useCallback(() => {
    if (!mapRef.current) return null;
    const b = mapRef.current.getBounds();
    return {
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast()
    };
  }, []);

  const handleSetDestination = async (dest: [number, number], preloadedRoute?: RouteResult) => {
    clearDestination();
    setDestination(dest);
    localStorage.setItem('lastDest', JSON.stringify(dest));

    destMarkerRef.current = L.marker(dest).addTo(mapRef.current!).bindPopup('Tujuan').openPopup();

    if (preloadedRoute) {
      routeDataRef.current = preloadedRoute;
      setRouteSource(preloadedRoute.source);
      drawRoute(preloadedRoute.geometry);
    } else if (userMarkerRef.current) {
      const userLatLng = userMarkerRef.current.getLatLng();
      try {
        setToastMsg('Mencari rute...');
        const route = await getRoute([userLatLng.lat, userLatLng.lng], dest);
        routeDataRef.current = route;
        setRouteSource(route.source);
        localStorage.setItem('lastRoute', JSON.stringify(route));
        drawRoute(route.geometry);
        setToastMsg(route.source === 'offline' ? 'Rute offline ditemukan!' : 'Rute ditemukan!');
      } catch (error: any) {
        setToastMsg(error.message || 'Gagal membuat rute.');
      }
    }
  };

  const initGPS = async () => {
    try {
      await Geolocation.requestPermissions();
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
      setCurrentLocation(coords);
      setGpsAccuracy(pos.coords.accuracy);
      updateUserMarker(coords);
      mapRef.current?.setView(coords, 16);

      // Mulai GPS watch SATU KALI — berjalan sepanjang sesi
      startPersistentGPS();
    } catch (err) {
      console.error('[GPS] Init error:', err);
      setToastMsg('Gagal mengakses GPS. Pastikan izin lokasi diberikan.');
    }
  };

  const updateUserMarker = (coords: [number, number]) => {
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.circleMarker(coords, {
        radius: 8,
        fillColor: '#0ea5e9',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 1
      }).addTo(mapRef.current!);
    } else {
      userMarkerRef.current.setLatLng(coords);
    }
  };

  const drawRoute = (geometry: { type: string; coordinates: number[][] }) => {
    if (routeLayerRef.current) mapRef.current?.removeLayer(routeLayerRef.current);
    routeLayerRef.current = L.geoJSON(geometry as any, {
      style: {
        color: '#0ea5e9',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }
    }).addTo(mapRef.current!);
    mapRef.current?.fitBounds(routeLayerRef.current.getBounds(), { padding: [60, 60] });
  };

  const clearDestination = () => {
    if (destMarkerRef.current) mapRef.current?.removeLayer(destMarkerRef.current);
    if (routeLayerRef.current) mapRef.current?.removeLayer(routeLayerRef.current);
    destMarkerRef.current = null;
    routeLayerRef.current = null;
    routeDataRef.current = null;
    setDestination(null);
    setRouteSource(null);
    localStorage.removeItem('lastDest');
    localStorage.removeItem('lastRoute');
  };

  // === GPS WATCH PERSISTEN ===
  // Satu watch berjalan terus, perilaku berubah berdasarkan isNavigatingRef
  let lastGpsUpdate = 0;

  const startPersistentGPS = async () => {
    try {
      watchIdRef.current = await Geolocation.watchPosition(
        { enableHighAccuracy: true, maximumAge: 500, timeout: 10000 },
        (position, err) => {
          if (err || !position) {
            console.warn('[GPS] Watch error:', err);
            return;
          }

          const coords: [number, number] = [position.coords.latitude, position.coords.longitude];
          const accuracy = position.coords.accuracy;

          // Marker SELALU diupdate real-time (baik pasif maupun navigasi)
          updateUserMarker(coords);

          const now = Date.now();
          const throttleMs = isNavigatingRef.current ? 1000 : 2500;

          if (now - lastGpsUpdate < throttleMs) return;
          lastGpsUpdate = now;

          // Update state (di-throttle)
          setCurrentLocation(coords);
          setGpsAccuracy(accuracy);

          // === MODE NAVIGASI ===
          if (isNavigatingRef.current) {
            // Pan ke posisi pengguna jika follow aktif
            if (followUserRef.current) {
              mapRef.current?.panTo(coords);
            }

            // Kalkulasi jarak ke tujuan
            if (destMarkerRef.current) {
              try {
                const destLatLng = destMarkerRef.current.getLatLng();
                const ptFrom = turf.point([coords[1], coords[0]]);
                const ptTo = turf.point([destLatLng.lng, destLatLng.lat]);
                const distance = turf.distance(ptFrom, ptTo, { units: 'kilometers' });
                setDistanceLeft(distance.toFixed(2));

                // Auto-stop jika sudah dekat tujuan (< 30 meter)
                if (distance < 0.03) {
                  setToastMsg('Anda telah tiba di tujuan!');
                  doStopNavigation();
                }
              } catch (e) {
                console.warn('[GPS] Distance calc error:', e);
              }
            }
          }
        }
      );
      console.log('[GPS] Persistent watch started, id:', watchIdRef.current);
    } catch (err) {
      console.error('[GPS] Failed to start watch:', err);
      setToastMsg('Gagal memulai pelacakan GPS.');
    }
  };

  // === NAVIGASI ===
  const startNavigation = () => {
    // Set mode navigasi
    setIsNavigating(true);
    isNavigatingRef.current = true;
    setFollowUser(true);
    followUserRef.current = true;
    lastGpsUpdate = 0; // Reset throttle agar langsung update
    setToastMsg('Navigasi Dimulai!');

    // Zoom ke posisi pengguna
    if (currentLocation) {
      mapRef.current?.setView(currentLocation, 18);

      // Hitung jarak awal langsung
      if (destMarkerRef.current) {
        try {
          const destLatLng = destMarkerRef.current.getLatLng();
          const ptFrom = turf.point([currentLocation[1], currentLocation[0]]);
          const ptTo = turf.point([destLatLng.lng, destLatLng.lat]);
          const distance = turf.distance(ptFrom, ptTo, { units: 'kilometers' });
          setDistanceLeft(distance.toFixed(2));
        } catch (e) {
          console.warn('[Nav] Initial distance calc error:', e);
        }
      }
    }
  };

  // stopNavigation: HARUS selalu berhasil (tidak boleh throw)
  const doStopNavigation = () => {
    // 1. Reset state DULU (sinkron) — ini memastikan UI langsung berubah
    setIsNavigating(false);
    isNavigatingRef.current = false;
    setFollowUser(true);
    followUserRef.current = true;
    setDistanceLeft('0');
    clearDestination();
    // GPS watch TIDAK di-clear — tetap berjalan dalam mode pasif
  };

  const stopNavigation = () => {
    doStopNavigation();
  };

  // Tombol Fokuskan (recenter)
  const handleRecenter = () => {
    setFollowUser(true);
    followUserRef.current = true;
    if (currentLocation) {
      mapRef.current?.setView(currentLocation, mapRef.current.getZoom());
    }
  };

  // === FAVORIT ===
  const saveToFavorites = () => {
    if (!destination) return;
    const name = prompt('Beri nama untuk lokasi ini:', `Lokasi ${favorites.length + 1}`);
    if (name) {
      const newFav: FavoritePlace = {
        id: Date.now().toString(),
        name,
        lat: destination[0],
        lng: destination[1]
      };
      const updated = [...favorites, newFav];
      setFavorites(updated);
      localStorage.setItem('favPlaces', JSON.stringify(updated));
      setToastMsg('Lokasi ditambahkan ke Favorit!');
    }
  };

  const removeFavorite = (id: string) => {
    const updated = favorites.filter(f => f.id !== id);
    setFavorites(updated);
    localStorage.setItem('favPlaces', JSON.stringify(updated));
  };

  const goToFavorite = (fav: FavoritePlace) => {
    setShowFavoritesModal(false);
    handleSetDestination([fav.lat, fav.lng]);
  };

  // === RENDER ===
  return (
    <IonPage>
      <IonContent fullscreen>
        {/* Peta */}
        <div id="mapId"></div>

        {/* Status Koneksi & GPS (pojok kiri atas, agak turun agar tidak tertumpuk) */}
        {!isNavigating && (
          <StatusIndicator isOnline={isOnline} gpsAccuracy={gpsAccuracy} />
        )}

        {/* Panel Navigasi (atas, saat navigasi aktif) */}
        {isNavigating && (
          <NavigationPanel
            distanceLeft={distanceLeft}
            routeSource={routeSource}
            onStop={stopNavigation}
          />
        )}

        {/* Tombol Fokuskan / Recenter (ala Google Maps) */}
        {isNavigating && !followUser && (
          <button className="fab-recenter" onClick={handleRecenter} aria-label="Fokuskan ke posisi saya">
            <IonIcon icon={locateOutline} />
          </button>
        )}

        {/* Tombol Aksi Bawah: Mulai Navigasi & Simpan Favorit */}
        {destination && !isNavigating && (
          <div className="bottom-action-bar">
            <IonButton expand="block" className="btn-start-nav" size="large" onClick={startNavigation}>
              <IonIcon slot="start" icon={navigateOutline} /> Mulai
            </IonButton>
            <IonButton className="btn-save-fav" color="warning" size="large" onClick={saveToFavorites}>
              <IonIcon slot="icon-only" icon={star} />
            </IonButton>
          </div>
        )}

        {/* FAB Group Kanan Atas */}
        {!isNavigating && (
          <div className="fab-group">
            {/* Daftar Favorit */}
            <button
              className="fab-btn fab-btn-fav"
              onClick={() => setShowFavoritesModal(true)}
              aria-label="Lokasi favorit"
            >
              <IonIcon icon={listOutline} />
            </button>

            {/* Download Area Offline */}
            <button
              className="fab-btn fab-btn-download"
              onClick={() => setShowDownloadModal(true)}
              aria-label="Unduh area offline"
            >
              <IonIcon icon={downloadOutline} />
            </button>

            {/* Tema Peta (paling bawah) */}
            <div style={{ position: 'relative' }}>
              <button
                className="fab-btn fab-btn-glass"
                onClick={() => setShowThemeDropdown(!showThemeDropdown)}
                aria-label="Ganti tema peta"
              >
                <IonIcon icon={layersOutline} />
              </button>
              {showThemeDropdown && (
                <div className="theme-dropdown">
                  <button
                    className={`theme-option theme-option-light ${currentTheme === 'OSM' ? 'active' : ''}`}
                    onClick={() => { applyMapTheme('OSM'); setShowThemeDropdown(false); }}
                    title="Terang"
                  >
                    T
                  </button>
                  <button
                    className={`theme-option theme-option-dark ${currentTheme === 'Dark' ? 'active' : ''}`}
                    onClick={() => { applyMapTheme('Dark'); setShowThemeDropdown(false); }}
                    title="Gelap"
                  >
                    G
                  </button>
                  <button
                    className={`theme-option theme-option-sat ${currentTheme === 'Satellite' ? 'active' : ''}`}
                    onClick={() => { applyMapTheme('Satellite'); setShowThemeDropdown(false); }}
                    title="Satelit"
                  >
                    S
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* FAB Kiri Atas: Hapus Tujuan (posisi diturunkan agar tidak tumpuk status) */}
        {!isNavigating && destination && (
          <div className="fab-clear-dest">
            <button className="fab-btn fab-btn-danger" onClick={clearDestination} aria-label="Hapus tujuan">
              <IonIcon icon={trashOutline} />
            </button>
          </div>
        )}

        {/* Toast Notifikasi */}
        <IonToast
          isOpen={toastMsg.length > 0}
          message={toastMsg}
          duration={2500}
          onDidDismiss={() => setToastMsg('')}
          position="bottom"
        />

        {/* Modal Favorit */}
        <IonModal
          isOpen={showFavoritesModal}
          onDidDismiss={() => setShowFavoritesModal(false)}
          initialBreakpoint={0.5}
          breakpoints={[0, 0.5, 0.8]}
        >
          <IonHeader>
            <IonToolbar>
              <IonTitle>Lokasi Tersimpan</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowFavoritesModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="favorites-modal-content">
            <IonList style={{ background: 'transparent' }}>
              {favorites.length === 0 && (
                <div className="fav-empty">
                  <IonIcon icon={starOutline} style={{ fontSize: 48, opacity: 0.3 }} />
                  <p>Belum ada lokasi favorit.</p>
                  <p style={{ fontSize: 12 }}>Pilih tujuan di peta, lalu tekan ★ untuk menyimpan.</p>
                </div>
              )}
              {favorites.map(fav => (
                <IonItem key={fav.id} className="fav-item" lines="none">
                  <IonLabel onClick={() => goToFavorite(fav)}>
                    <h2>{fav.name}</h2>
                    <p>{fav.lat.toFixed(4)}, {fav.lng.toFixed(4)}</p>
                  </IonLabel>
                  <IonButton slot="end" fill="clear" color="danger" onClick={() => removeFavorite(fav.id)}>
                    <IonIcon icon={trashOutline} />
                  </IonButton>
                </IonItem>
              ))}
            </IonList>
          </IonContent>
        </IonModal>

        {/* Modal Download Area */}
        <DownloadAreaControl
          isOpen={showDownloadModal}
          onDismiss={() => setShowDownloadModal(false)}
          getMapBounds={getMapBounds}
          currentTileUrl={MAP_STYLES[currentTheme]}
          onToast={setToastMsg}
        />
      </IonContent>
    </IonPage>
  );
};

export default Home;
