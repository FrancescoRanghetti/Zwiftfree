import { bearing, distance, turn } from '../../../physics/geo';
import {
  ScenePoint,
  aboveGround,
  dampAngle,
  dampSpring,
  firstPersonPose,
  frustumFov,
  offsetPoint,
  smoothPose,
  startMotion,
  thirdPersonPose,
} from './camera';

const ROAD: ScenePoint = { lon: 9, lat: 46, ele: 200 };

describe('3D ride cameras', () => {
  it('preserves vertical FOV when Cesium uses a horizontal landscape FOV', () => {
    for (const aspect of [1, 4 / 3, 16 / 9, 2.5]) {
      const angle = frustumFov(60, aspect);
      const vertical = aspect > 1 ? 2 * Math.atan(Math.tan(angle / 2) / aspect) : angle;
      expect(vertical).toBeCloseTo(Math.PI / 3, 10);
    }
    expect(frustumFov(73, 0.6)).toBeCloseTo((73 * Math.PI) / 180);
  });
  it('places the third-person camera seven metres behind and above the rider', () => {
    const camera = thirdPersonPose(ROAD, 90, 0);
    expect(distance([ROAD.lon, ROAD.lat], [camera.position.lon, camera.position.lat])).toBeCloseTo(
      7,
      2,
    );
    expect(bearing([ROAD.lon, ROAD.lat], [camera.position.lon, camera.position.lat])).toBeCloseTo(
      270,
      2,
    );
    expect(camera.position.ele).toBeCloseTo(202.8);
    expect(camera.target.lon).toBeGreaterThan(ROAD.lon);
    expect(camera.headingDeg).toBeCloseTo(90, 2);
    expect(camera.fovDeg).toBe(60);
  });

  it('looks along the curved course instead of along the local tangent', () => {
    const ahead = offsetPoint(ROAD, 65, 18);
    const camera = thirdPersonPose(ROAD, 0, 0, { lookAheadPoint: ahead });
    expect(camera.target).toEqual({ ...ahead, ele: ahead.ele + 1.1 });
    expect(camera.headingDeg).toBeGreaterThan(30);
    expect(camera.headingDeg).toBeLessThan(65);
    expect(camera.headingDeg).toBeCloseTo(
      bearing([camera.position.lon, camera.position.lat], [ahead.lon, ahead.lat]),
      8,
    );
  });

  it('raises the third-person camera on a climb and follows the road elevation ahead', () => {
    const ahead = { ...offsetPoint(ROAD, 0, 18), ele: ROAD.ele + 4 };
    const climb = thirdPersonPose(ROAD, 0, 10, { lookAheadPoint: ahead });
    const flat = thirdPersonPose(ROAD, 0, 0);
    const descent = thirdPersonPose(ROAD, 0, -10);
    expect(climb.position.ele - flat.position.ele).toBeCloseTo(0.3);
    expect(descent.position.ele - flat.position.ele).toBeCloseTo(-0.3);
    expect(climb.target.ele).toBeCloseTo(205.1);
    expect(climb.pitchDeg).toBeGreaterThan(0);
    expect(flat.pitchDeg).toBeLessThan(0);
  });

  it('places the eyes at 1.55 metres and follows an uphill look-ahead point', () => {
    const ahead = { ...offsetPoint(ROAD, 0, 15), ele: ROAD.ele + 2 };
    const camera = firstPersonPose(ROAD, 0, ahead);
    expect(camera.position).toEqual({ ...ROAD, ele: 201.55 });
    expect(camera.target).toEqual({ ...ahead, ele: 203.55 });
    expect(camera.pitchDeg).toBeCloseTo((Math.atan2(2, 15) * 180) / Math.PI, 2);
    expect(camera.fovDeg).toBe(73);
  });

  it('keeps head bob off by default and oscillates at half the pedal cadence when enabled', () => {
    const ahead = offsetPoint(ROAD, 0, 15);
    expect(firstPersonPose(ROAD, 0, ahead, { pedalPhase: Math.PI }).position.ele).toBe(201.55);
    expect(firstPersonPose(ROAD, 0, ahead, { pedalPhase: Math.PI }).rollDeg).toBe(0);

    const bob = (pedalPhase: number) =>
      firstPersonPose(ROAD, 0, ahead, { headBobEnabled: true, pedalPhase });
    expect(bob(Math.PI).position.ele).toBeCloseTo(201.565);
    expect(bob(Math.PI).rollDeg).toBeCloseTo(0.5);
    expect(bob(2 * Math.PI).position.ele).toBeCloseTo(201.55);
    expect(bob(3 * Math.PI).position.ele).toBeCloseTo(201.535);
    expect(bob(3 * Math.PI).rollDeg).toBeCloseTo(-0.5);
    expect(bob(4 * Math.PI).position.ele).toBeCloseTo(201.55);
  });

  it('clamps both cameras above terrain without pulling a bridge down to the ground', () => {
    const ahead = offsetPoint(ROAD, 0, 15);
    expect(thirdPersonPose(ROAD, 0, 0, { groundHeight: 210 }).position.ele).toBeCloseTo(210.35);
    expect(firstPersonPose(ROAD, 0, ahead, { groundHeight: 210 }).position.ele).toBeCloseTo(210.35);
    expect(firstPersonPose(ROAD, 0, ahead, { groundHeight: 150 }).position.ele).toBeCloseTo(201.55);
    expect(aboveGround(ROAD, undefined)).toEqual(ROAD);
    expect(aboveGround(ROAD, Number.NaN)).toEqual(ROAD);
  });

  it('clamps newly refined terrain after smoothing and keeps the next frame above it', () => {
    const desired = firstPersonPose(ROAD, 0, offsetPoint(ROAD, 0, 15));
    const lifted = smoothPose(startMotion(desired), desired, 1 / 60, 215);
    expect(lifted.pose.position.ele).toBeCloseTo(215.35);
    expect(lifted.motion.ele.value).toBeCloseTo(215.35);
    expect(lifted.motion.ele.velocity).toBeGreaterThanOrEqual(0);
    const next = smoothPose(lifted.motion, desired, 1 / 60, 215);
    expect(next.pose.position.ele).toBeCloseTo(215.35);
  });
});

describe('critically damped camera motion', () => {
  it('approaches a stationary target monotonically without overshoot', () => {
    let state = { value: 0, velocity: 0 };
    for (let frame = 0; frame < 180; frame++) {
      const next = dampSpring(state, 10, 1 / 60);
      expect(next.value).toBeGreaterThanOrEqual(state.value);
      expect(next.value).toBeLessThanOrEqual(10);
      expect(next.velocity).toBeGreaterThanOrEqual(0);
      state = next;
    }
    expect(state.value).toBeCloseTo(10, 6);
  });

  it('has the same solution at 30 fps, 60 fps and in one large step', () => {
    const initial = { value: -5, velocity: 2 };
    const simulate = (frames: number) => {
      let state = initial;
      for (let frame = 0; frame < frames; frame++) state = dampSpring(state, 7, 1 / frames);
      return state;
    };
    const oneStep = dampSpring(initial, 7, 1);
    for (const result of [simulate(30), simulate(60)]) {
      expect(result.value).toBeCloseTo(oneStep.value, 10);
      expect(result.velocity).toBeCloseTo(oneStep.velocity, 10);
    }
    expect(dampSpring(initial, 7, 0)).toBe(initial);
  });

  it('turns from 359 degrees to 1 degree over the short arc', () => {
    let state = { value: 359, velocity: 0 };
    for (let frame = 0; frame < 60; frame++) {
      const next = dampAngle(state, 1, 1 / 60);
      expect(next.value).toBeGreaterThanOrEqual(state.value);
      expect(next.value).toBeLessThanOrEqual(361);
      state = next;
    }
    expect(Math.abs(turn(state.value, 1))).toBeLessThan(0.001);
  });
});
