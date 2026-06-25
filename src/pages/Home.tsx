import React, { useEffect, useRef, useState } from 'react';
import { 
  IonContent, IonPage, IonFab, IonFabButton, IonIcon, 
  IonFabList, useIonViewDidEnter, IonButton, IonToast,
  IonModal, IonHeader, IonToolbar, IonTitle, IonList, IonItem, IonLabel, IonButtons
} from '@ionic/react';
import { layersOutline, trashOutline, navigateOutline, mapOutline, closeCircleOutline, starOutline, star, listOutline } from 'ionicons/icons';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { getRoute } from '../services/RoutingService';
import { offlineTileLayer } from '../components/OfflineTileLayer';
import * as turf from '@turf/turf';

import markerIconPng from 'leaflet/dist/images/marker-icon.png';
import markerShadowPng from 'leaflet/dist/images/marker-shadow.png';

const defaultIcon = new L.Icon({
  iconUrl: markerIconPng, shadowUrl: markerShadowPng,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});
L.Marker.prototype.options.icon = defaultIcon;

const MAP_STYLES = {
  OSM: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  Satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  Dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

type FavoritePlace = { id: string; name: string; lat: number; lng: number };

const Home: React.FC = () => {
  const mapRef = useRef<L.Map | null>(null);
  const currentTileLayerRef = useRef<L.TileLayer | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const routeLayerRef = useRef<L.GeoJSON | null>(null);
  const routeDataRef = useRef<any>(null);
  const watchIdRef = useRef<string | null>(null);
  const isNavigatingRef = useRef(false); 

  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);
  const [destination, setDestination] = useState<[number, number] | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [distanceLeft, setDistanceLeft] = useState('0');
  
  // State untuk Favorit
  const [favorites, setFavorites] = useState<FavoritePlace[]>([]);
  const [showFavoritesModal, setShowFavoritesModal] = useState(false);

  useIonViewDidEnter(() => {
    if (mapRef.current) setTimeout(() => mapRef.current?.invalidateSize(), 100);
  });

  useEffect(() => {
    // 1. DOUBLE TAP BACK BUTTON LOGIC
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

    // 2. MUAT DATA FAVORIT DARI STORAGE
    const savedFavs = localStorage.getItem('favPlaces');
    if (savedFavs) setFavorites(JSON.parse(savedFavs));

    // 3. INISIALISASI PETA
    if (!mapRef.current) {
      mapRef.current = L.map('mapId', { zoomControl: false }).setView([-2.5489, 118.0149], 5);
      setMapTheme(MAP_STYLES.Dark);

      // PENGUNCI EVENT KLIK
      mapRef.current.on('click', async (e: L.LeafletMouseEvent) => {
        if (isNavigatingRef.current) return; 
        const dest: [number, number] = [e.latlng.lat, e.latlng.lng];
        handleSetDestination(dest);
      });

      initGPS();

      // 4. RESTORE RUTE TERAKHIR JIKA ADA (State Persistence)
      setTimeout(() => {
        const savedDest = localStorage.getItem('lastDest');
        const savedRoute = localStorage.getItem('lastRoute');
        if (savedDest && savedRoute) {
          const destCoords = JSON.parse(savedDest);
          handleSetDestination(destCoords, JSON.parse(savedRoute));
          setToastMsg("Memuat rute terakhir Anda...");
        }
      }, 1000);
    }

    return () => { 
      backButtonListener.then(handle => handle.remove()); 
    };
  }, []);

  const handleSetDestination = async (dest: [number, number], preloadedRoute?: any) => {
    clearDestination();
    setDestination(dest);
    
    // Simpan koordinat ke HP
    localStorage.setItem('lastDest', JSON.stringify(dest));

    destMarkerRef.current = L.marker(dest).addTo(mapRef.current!).bindPopup("Tujuan").openPopup();

    if (preloadedRoute) {
       // Muat rute offline
       routeDataRef.current = preloadedRoute;
       drawRoute(preloadedRoute.geometry);
    } else {
       // Tarik rute online
       if (userMarkerRef.current) {
         const userLatLng = userMarkerRef.current.getLatLng();
         try {
           setToastMsg("Mencari rute...");
           const route = await getRoute([userLatLng.lat, userLatLng.lng], dest);
           routeDataRef.current = route;
           localStorage.setItem('lastRoute', JSON.stringify(route)); // Simpan rute ke HP
           drawRoute(route.geometry);
         } catch (error) {
           setToastMsg("Gagal membuat rute. Periksa koneksi.");
         }
       }
    }
  };

  const initGPS = async () => {
    await Geolocation.requestPermissions();
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
    const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
    setCurrentLocation(coords);
    updateUserMarker(coords);
    mapRef.current?.setView(coords, 16);
  };

  const updateUserMarker = (coords: [number, number]) => {
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.circleMarker(coords, {
        radius: 8, fillColor: "#007bff", color: "#ffffff", weight: 3, opacity: 1, fillOpacity: 1
      }).addTo(mapRef.current!);
    } else {
      userMarkerRef.current.setLatLng(coords);
    }
  };

  const drawRoute = (geometry: any) => {
    if (routeLayerRef.current) mapRef.current?.removeLayer(routeLayerRef.current);
    routeLayerRef.current = L.geoJSON(geometry, {
      style: { color: '#007bff', weight: 6, opacity: 0.8 }
    }).addTo(mapRef.current!);
    mapRef.current?.fitBounds(routeLayerRef.current.getBounds(), { padding: [50, 50] });
  };

  const setMapTheme = (url: string) => {
    if (!mapRef.current) return;
    if (currentTileLayerRef.current) mapRef.current.removeLayer(currentTileLayerRef.current);
    
    // Gunakan OfflineTileLayer buatan kita!
    currentTileLayerRef.current = offlineTileLayer(url, { maxZoom: 19 }).addTo(mapRef.current);
  };

  const clearDestination = () => {
    if (destMarkerRef.current) mapRef.current?.removeLayer(destMarkerRef.current);
    if (routeLayerRef.current) mapRef.current?.removeLayer(routeLayerRef.current);
    destMarkerRef.current = null;
    routeLayerRef.current = null;
    routeDataRef.current = null;
    setDestination(null);
    localStorage.removeItem('lastDest');
    localStorage.removeItem('lastRoute');
  };

  const startNavigation = async () => {
    setIsNavigating(true);
    isNavigatingRef.current = true;
    setToastMsg("Navigasi Dimulai! Mode Offline Aktif.");
    if (currentLocation) mapRef.current?.setView(currentLocation, 18);

    // OPTIMASI GPS: timeout ditambahkan agar lebih responsif
    watchIdRef.current = await Geolocation.watchPosition(
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 },
      (position, err) => {
        if (!position) return;
        const coords: [number, number] = [position.coords.latitude, position.coords.longitude];
        
        updateUserMarker(coords);
        setCurrentLocation(coords);
        mapRef.current?.panTo(coords);

        if (routeDataRef.current && destMarkerRef.current) {
           const destLatLng = destMarkerRef.current.getLatLng();
           const ptFrom = turf.point([coords[1], coords[0]]);
           const ptTo = turf.point([destLatLng.lng, destLatLng.lat]);
           const distance = turf.distance(ptFrom, ptTo, { units: 'kilometers' });
           setDistanceLeft(distance.toFixed(2));
        }
      }
    );
  };

  const stopNavigation = async () => {
    if (watchIdRef.current) {
      await Geolocation.clearWatch({ id: watchIdRef.current });
      watchIdRef.current = null;
    }
    setIsNavigating(false);
    isNavigatingRef.current = false;
    clearDestination();
  };

  // --- FUNGSI FAVORIT ---
  const saveToFavorites = () => {
    if (!destination) return;
    const name = prompt("Beri nama untuk lokasi ini:", `Lokasi ${favorites.length + 1}`);
    if (name) {
      const newFav = { id: Date.now().toString(), name, lat: destination[0], lng: destination[1] };
      const updated = [...favorites, newFav];
      setFavorites(updated);
      localStorage.setItem('favPlaces', JSON.stringify(updated));
      setToastMsg("Lokasi ditambahkan ke Favorit!");
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

  return (
    <IonPage>
      <IonContent fullscreen>
        <div id="mapId" style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '100%', zIndex: 1 }}></div>

        {isNavigating && (
          <div style={{ position: 'absolute', top: '20px', left: '5%', width: '90%', zIndex: 999, backgroundColor: '#1e1e1e', color: 'white', padding: '15px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>{distanceLeft} km</h2>
              <p style={{ margin: 0, fontSize: '14px', color: '#aaa' }}>Menuju Tujuan</p>
            </div>
            <IonButton color="danger" onClick={stopNavigation}>
              <IonIcon slot="icon-only" icon={closeCircleOutline} />
            </IonButton>
          </div>
        )}

        {/* Panel Tombol Bawah (Mulai & Simpan Favorit) */}
        {destination && !isNavigating && (
          <div style={{ position: 'absolute', bottom: '20px', left: '5%', width: '90%', zIndex: 999, display: 'flex', gap: '10px' }}>
            <IonButton expand="block" color="primary" style={{ flex: 1 }} size="large" onClick={startNavigation}>
              <IonIcon slot="start" icon={navigateOutline} /> Mulai
            </IonButton>
            <IonButton color="warning" size="large" onClick={saveToFavorites}>
              <IonIcon slot="icon-only" icon={star} />
            </IonButton>
          </div>
        )}

        {/* FAB Kanan Atas 1: DAFTAR FAVORIT (Posisi Paling Atas) */}
        {!isNavigating && (
          <IonFab vertical="top" horizontal="end" slot="fixed" style={{ zIndex: 999, marginTop: '10px' }}>
            <IonFabButton color="tertiary" onClick={() => setShowFavoritesModal(true)}>
              <IonIcon icon={listOutline} />
            </IonFabButton>
          </IonFab>
        )}

        {/* FAB Kanan Atas 2: TEMA PETA (Posisi di bawah tombol Favorit) */}
        {!isNavigating && (
          <IonFab vertical="top" horizontal="end" slot="fixed" style={{ zIndex: 999, marginTop: '80px' }}>
            <IonFabButton color="light">
              <IonIcon icon={layersOutline} />
            </IonFabButton>
            <IonFabList side="bottom">
              <IonFabButton onClick={() => setMapTheme(MAP_STYLES.OSM)} title="Standard"><IonIcon icon={mapOutline} /></IonFabButton>
              <IonFabButton onClick={() => setMapTheme(MAP_STYLES.Satellite)} title="Satelit" color="success"><IonIcon icon={mapOutline} /></IonFabButton>
              <IonFabButton onClick={() => setMapTheme(MAP_STYLES.Dark)} title="Mode Gelap" color="dark"><IonIcon icon={mapOutline} /></IonFabButton>
            </IonFabList>
          </IonFab>
        )}

        {/* FAB Kiri Atas (HAPUS TUJUAN - dipindah agar tidak menumpuk) */}
        {!isNavigating && destination && (
           <IonFab vertical="top" horizontal="start" slot="fixed" style={{ zIndex: 999, marginTop: '10px' }}>
             <IonFabButton color="danger" onClick={clearDestination}>
               <IonIcon icon={trashOutline} />
             </IonFabButton>
           </IonFab>
        )}

        <IonToast isOpen={toastMsg.length > 0} message={toastMsg} duration={2000} onDidDismiss={() => setToastMsg('')} />

        {/* MODAL FAVORIT */}
        <IonModal isOpen={showFavoritesModal} onDidDismiss={() => setShowFavoritesModal(false)} initialBreakpoint={0.5} breakpoints={[0, 0.5, 0.8]}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Lokasi Tersimpan</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowFavoritesModal(false)}>Tutup</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <IonList>
              {favorites.length === 0 && <IonItem><IonLabel>Belum ada lokasi favorit.</IonLabel></IonItem>}
              {favorites.map(fav => (
                <IonItem key={fav.id}>
                  <IonLabel onClick={() => goToFavorite(fav)}>
                    <h2>{fav.name}</h2>
                    <p>{fav.lat.toFixed(4)}, {fav.lng.toFixed(4)}</p>
                  </IonLabel>
                  <IonButton fill="clear" color="danger" onClick={() => removeFavorite(fav.id)}>Hapus</IonButton>
                </IonItem>
              ))}
            </IonList>
          </IonContent>
        </IonModal>

      </IonContent>
    </IonPage>
  );
};

export default Home;
