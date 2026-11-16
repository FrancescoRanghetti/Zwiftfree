export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface AvatarConfig {
  jerseyColor: string;
  helmetColor: string;
  bikeColor: string;
}

export type Units = 'metric' | 'imperial';
export type RideView = 'MAP_2D' | 'THIRD_PERSON' | 'FIRST_PERSON';
export type SceneQuality = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Profile {
  weightKg: number;
  heightCm: number | null;
  birthYear: number | null;
  ftpWatts: number;
  maxHr: number | null;
  restingHr: number | null;
  bikeWeightKg: number;
  cda: number;
  crr: number;
  units: Units;
  avatar: AvatarConfig;
}

export interface Settings {
  peeBreakEnabled: boolean;
  peeBreakAfterSeconds: number;
  crashEventsEnabled: boolean;
  trainerDifficulty: number;
  audioEnabled: boolean;
  cornerAssistEnabled: boolean;
  rideView: RideView;
  headBobEnabled: boolean;
  sceneQuality: SceneQuality;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  profile: Profile;
  settings: Settings;
}

export type ProfileUpdate = Omit<Profile, 'cda' | 'crr'> &
  Partial<Pick<Profile, 'cda' | 'crr'>> & { displayName: string };
