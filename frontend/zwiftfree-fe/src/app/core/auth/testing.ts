import { Me } from './auth.models';

export const ME: Me = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'mario@example.ch',
  displayName: 'Mario',
  createdAt: '2026-11-15T10:00:00Z',
  profile: {
    weightKg: 75,
    heightCm: 180,
    birthYear: 1985,
    ftpWatts: 250,
    maxHr: 185,
    restingHr: 50,
    bikeWeightKg: 8,
    cda: 0.32,
    crr: 0.004,
    units: 'metric',
    avatar: { jerseyColor: '#ff9800', helmetColor: '#fafafa', bikeColor: '#263238' },
  },
  settings: {
    peeBreakEnabled: true,
    peeBreakAfterSeconds: 20,
    crashEventsEnabled: true,
    trainerDifficulty: 1,
    audioEnabled: true,
    cornerAssistEnabled: false,
    rideView: 'MAP_2D',
    headBobEnabled: false,
    sceneQuality: 'MEDIUM',
  },
};

export const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 };
