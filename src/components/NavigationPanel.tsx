// src/components/NavigationPanel.tsx
// Panel informasi navigasi yang tampil saat pengguna sedang dalam mode navigasi

import React from 'react';
import { IonIcon } from '@ionic/react';
import { closeCircleOutline, navigateOutline, cloudOfflineOutline, cloudDoneOutline } from 'ionicons/icons';

interface NavigationPanelProps {
  distanceLeft: string;
  routeSource: 'online' | 'offline' | null;
  onStop: () => void;
}

const NavigationPanel: React.FC<NavigationPanelProps> = ({ distanceLeft, routeSource, onStop }) => {
  return (
    <div className="nav-panel">
      <div className="nav-panel-info">
        <div className="nav-panel-distance">
          <IonIcon icon={navigateOutline} className="nav-panel-icon" />
          <span className="nav-distance-value">{distanceLeft}</span>
          <span className="nav-distance-unit">km</span>
        </div>
        <div className="nav-panel-subtitle">
          <span className="nav-label">Menuju Tujuan</span>
          <span className={`nav-source-badge ${routeSource === 'offline' ? 'badge-offline' : 'badge-online'}`}>
            <IonIcon icon={routeSource === 'offline' ? cloudOfflineOutline : cloudDoneOutline} />
            {routeSource === 'offline' ? 'Offline' : 'Online'}
          </span>
        </div>
      </div>
      <button className="nav-stop-btn" onClick={onStop} aria-label="Berhenti navigasi">
        <IonIcon icon={closeCircleOutline} />
      </button>
    </div>
  );
};

export default NavigationPanel;
