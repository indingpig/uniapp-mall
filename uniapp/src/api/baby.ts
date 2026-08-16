import http from '@/utils/request';

export interface BabyStatusData {
  status: 'sleeping' | 'awake' | 'crying' | 'playing' | 'offline';
  statusText: string;
  iconKey: string;
  iconColor: string;
  durationSec: number;
  isOnline: boolean;
}

export interface VolumeData {
  rms: number;
  peak: number;
  db: number;
  timestamp: number;
}

export interface DeviceData {
  name: string;
  connectionText: string;
  batteryPercent: number;
  signalStrength: number;
  isOnline: boolean;
}

export function fetchBabyStatus(): Promise<BabyStatusData> {
  return http.get<BabyStatusData>('/api/baby/status').then(res => res.data);
}

export function fetchVolume(): Promise<VolumeData> {
  return http.get<VolumeData>('/api/baby/volume').then(res => res.data);
}

export function fetchDevice(): Promise<DeviceData> {
  return http.get<DeviceData>('/api/baby/device').then(res => res.data);
}
