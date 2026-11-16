import { bearing, distance, turn } from '../../../physics/geo';

export interface ScenePoint {
  lon: number;
  lat: number;
  ele: number;
}

export interface CameraPose {
  position: ScenePoint;
  target: ScenePoint;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  fovDeg: number;
}

/** Cesium measures FOV on the wider viewport axis; ride cameras specify a vertical field of view. */
export function frustumFov(verticalFovDeg: number, aspectRatio: number): number {
  const vertical = (verticalFovDeg * Math.PI) / 180;
  return aspectRatio > 1 ? 2 * Math.atan(Math.tan(vertical / 2) * aspectRatio) : vertical;
}

interface PoseOptions {
  groundHeight?: number;
  clearanceM?: number;
}

/** Local tangent-plane offset; camera offsets span only a few metres. */
export function offsetPoint(point: ScenePoint, headingDeg: number, metres: number): ScenePoint {
  const angle = (headingDeg * Math.PI) / 180;
  return {
    lon: point.lon + (Math.sin(angle) * metres) / (111_195 * Math.cos((point.lat * Math.PI) / 180)),
    lat: point.lat + (Math.cos(angle) * metres) / 111_195,
    ele: point.ele,
  };
}

export function aboveGround(point: ScenePoint, height?: number, clearanceM = 0.35): ScenePoint {
  return {
    ...point,
    ele: Number.isFinite(height) ? Math.max(point.ele, height! + clearanceM) : point.ele,
  };
}

export function thirdPersonPose(
  point: ScenePoint,
  headingDeg: number,
  gradePct: number,
  opts: PoseOptions & { lookAheadPoint?: ScenePoint; distanceM?: number; heightM?: number } = {},
): CameraPose {
  const position = offsetPoint(point, headingDeg, -(opts.distanceM ?? 7));
  position.ele += (opts.heightM ?? 2.8) + Math.max(-0.6, Math.min(0.9, gradePct * 0.03));
  const ahead = opts.lookAheadPoint ?? offsetPoint(point, headingDeg, 18);
  const target = { ...ahead, ele: ahead.ele + 1.1 };
  return pose(aboveGround(position, opts.groundHeight, opts.clearanceM), target, headingDeg, 0, 60);
}

export function firstPersonPose(
  point: ScenePoint,
  headingDeg: number,
  lookAheadPoint: ScenePoint,
  opts: PoseOptions & { headBobEnabled?: boolean; pedalPhase?: number } = {},
): CameraPose {
  const wave = opts.headBobEnabled ? Math.sin((opts.pedalPhase ?? 0) / 2) : 0;
  const position = aboveGround(
    { ...point, ele: point.ele + 1.55 + wave * 0.015 },
    opts.groundHeight,
    opts.clearanceM,
  );
  const target = { ...lookAheadPoint, ele: lookAheadPoint.ele + 1.55 };
  return pose(position, target, headingDeg, wave * 0.5, 73);
}

function pose(
  position: ScenePoint,
  target: ScenePoint,
  fallbackHeading: number,
  rollDeg: number,
  fovDeg: number,
): CameraPose {
  const metres = distance([position.lon, position.lat], [target.lon, target.lat]);
  return {
    position,
    target,
    headingDeg:
      metres > 0.05
        ? bearing([position.lon, position.lat], [target.lon, target.lat])
        : fallbackHeading,
    pitchDeg: (Math.atan2(target.ele - position.ele, Math.max(metres, 0.1)) * 180) / Math.PI,
    rollDeg,
    fovDeg,
  };
}

export interface Spring {
  value: number;
  velocity: number;
}

/** Exact critically damped spring solution, independent of the rendering frame rate. */
export function dampSpring(state: Spring, target: number, dt: number, frequency = 12): Spring {
  if (dt <= 0) return state;
  const delta = state.value - target;
  const c = state.velocity + frequency * delta;
  const decay = Math.exp(-frequency * dt);
  return {
    value: target + (delta + c * dt) * decay,
    velocity: (state.velocity - frequency * c * dt) * decay,
  };
}

export function dampAngle(state: Spring, targetDeg: number, dt: number): Spring {
  return dampSpring(state, state.value + turn(state.value, targetDeg), dt);
}

export interface CameraMotion {
  lon: Spring;
  lat: Spring;
  ele: Spring;
  heading: Spring;
  pitch: Spring;
}

export function startMotion(p: CameraPose): CameraMotion {
  const still = (value: number): Spring => ({ value, velocity: 0 });
  return {
    lon: still(p.position.lon),
    lat: still(p.position.lat),
    ele: still(p.position.ele),
    heading: still(p.headingDeg),
    pitch: still(p.pitchDeg),
  };
}

export function smoothPose(
  motion: CameraMotion,
  desired: CameraPose,
  dt: number,
  groundHeight?: number,
): { motion: CameraMotion; pose: CameraPose } {
  const next = {
    lon: dampSpring(motion.lon, desired.position.lon, dt),
    lat: dampSpring(motion.lat, desired.position.lat, dt),
    ele: dampSpring(motion.ele, desired.position.ele, dt),
    heading: dampAngle(motion.heading, desired.headingDeg, dt),
    pitch: dampSpring(motion.pitch, desired.pitchDeg, dt),
  };
  const position = aboveGround(
    { lon: next.lon.value, lat: next.lat.value, ele: next.ele.value },
    groundHeight,
  );
  // Newly refined terrain must lift the camera immediately, including during smoothing.
  if (position.ele > next.ele.value)
    next.ele = { value: position.ele, velocity: Math.max(0, next.ele.velocity) };
  return {
    motion: next,
    pose: { ...desired, position, headingDeg: next.heading.value, pitchDeg: next.pitch.value },
  };
}
