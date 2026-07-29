// src/components/StatusIndicator.tsx
// Indikator status koneksi internet dan GPS di pojok kiri atas peta

import React from 'react';
import { IonIcon } from '@ionic/react';
import { wifiOutline, cloudOfflineOutline, locateOutline } from 'ionicons/icons';

interface StatusIndicatorProps {
  isOnline: boolean;
  gpsAccuracy: number | null; // dalam meter
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ isOnline, gpsAccuracy }) => {
  const getGpsLabel = () => {
    if (gpsAccuracy === null) return 'GPS...';
    if (gpsAccuracy <= 10) return `${Math.round(gpsAccuracy)}m ★`;
    if (gpsAccuracy <= 30) return `${Math.round(gpsAccuracy)}m`;
    return `${Math.round(gpsAccuracy)}m ⚠`;
  };

  return (
    <div className="status-indicator">
      <div className={`status-chip ${isOnline ? 'status-online' : 'status-offline'}`}>
        <IonIcon icon={isOnline ? wifiOutline : cloudOfflineOutline} />
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>
      {gpsAccuracy !== null && (
        <div className={`status-chip status-gps ${gpsAccuracy <= 15 ? 'gps-good' : gpsAccuracy <= 30 ? 'gps-ok' : 'gps-poor'}`}>
          <IonIcon icon={locateOutline} />
          <span>{getGpsLabel()}</span>
        </div>
      )}
    </div>
  );
};

export default StatusIndicator;
