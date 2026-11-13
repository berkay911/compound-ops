export type Vec = number[];
export type Mat = number[][];

export interface KalmanState {
  x: Vec;
  P: Mat;
}

export interface Ellipse {
  major: number;
  minor: number;
  angleRad: number;
}

export const GATE_CHI2_999 = 13.82;
export const CHI2_95_SCALE = Math.sqrt(5.991);

function mul(a: Mat, b: Mat): Mat {
  return a.map((row) => b[0].map((_, j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)));
}

function transpose(a: Mat): Mat {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

function inv2(m: Mat): Mat {
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  return [
    [m[1][1] / det, -m[0][1] / det],
    [-m[1][0] / det, m[0][0] / det],
  ];
}

export function initState(z: Vec, R: Mat, velocityVar: number): KalmanState {
  return {
    x: [z[0], z[1], 0, 0],
    P: [
      [R[0][0], R[0][1], 0, 0],
      [R[1][0], R[1][1], 0, 0],
      [0, 0, velocityVar, 0],
      [0, 0, 0, velocityVar],
    ],
  };
}

export function predict(s: KalmanState, dt: number, q: number): KalmanState {
  if (dt <= 0) return s;
  const F = [
    [1, 0, dt, 0],
    [0, 1, 0, dt],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  const a = (dt ** 4 / 4) * q;
  const b = (dt ** 3 / 2) * q;
  const c = dt ** 2 * q;
  const Q = [
    [a, 0, b, 0],
    [0, a, 0, b],
    [b, 0, c, 0],
    [0, b, 0, c],
  ];
  const x = F.map((row) => row.reduce((sum, v, k) => sum + v * s.x[k], 0));
  const FP = mul(F, s.P);
  const P = mul(FP, transpose(F)).map((row, i) => row.map((v, j) => v + Q[i][j]));
  return { x, P };
}

export function innovation(s: KalmanState, z: Vec, R: Mat): { nu: Vec; S: Mat; d2: number } {
  const nu = [z[0] - s.x[0], z[1] - s.x[1]];
  const S = [
    [s.P[0][0] + R[0][0], s.P[0][1] + R[0][1]],
    [s.P[1][0] + R[1][0], s.P[1][1] + R[1][1]],
  ];
  const Si = inv2(S);
  const d2 = nu[0] * (Si[0][0] * nu[0] + Si[0][1] * nu[1]) + nu[1] * (Si[1][0] * nu[0] + Si[1][1] * nu[1]);
  return { nu, S, d2 };
}

export function update(s: KalmanState, z: Vec, R: Mat): KalmanState {
  const { nu, S } = innovation(s, z, R);
  const Si = inv2(S);
  const PHt = s.P.map((row) => [row[0], row[1]]);
  const K = mul(PHt, Si);
  const x = s.x.map((v, i) => v + K[i][0] * nu[0] + K[i][1] * nu[1]);
  const KSKt = mul(mul(K, S), transpose(K));
  const P = s.P.map((row, i) => row.map((v, j) => v - KSKt[i][j]));
  const sym = P.map((row, i) => row.map((v, j) => (v + P[j][i]) / 2));
  return { x, P: sym };
}

export function positionEllipse(P: Mat): Ellipse {
  const a = P[0][0];
  const b = P[0][1];
  const c = P[1][1];
  const mid = (a + c) / 2;
  const radius = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  return {
    major: Math.sqrt(Math.max(mid + radius, 0)),
    minor: Math.sqrt(Math.max(mid - radius, 0)),
    angleRad: 0.5 * Math.atan2(2 * b, a - c),
  };
}

export interface ImmState {
  models: KalmanState[];
  mu: number[];
}

export const IMM_PROCESS_NOISE = [0.3, 15];
const IMM_DWELL_S = [10, 4];

function outer(d: Vec): Mat {
  return d.map((a) => d.map((b) => a * b));
}

function weightedSum(states: KalmanState[], w: number[]): KalmanState {
  const x = states[0].x.map((_, k) => states.reduce((sum, s, i) => sum + w[i] * s.x[k], 0));
  const P = states[0].P.map((row, r) =>
    row.map((_, c) =>
      states.reduce((sum, s, i) => {
        const d = s.x.map((v, k) => v - x[k]);
        return sum + w[i] * (s.P[r][c] + outer(d)[r][c]);
      }, 0),
    ),
  );
  return { x, P };
}

export function immInit(z: Vec, R: Mat, velocityVar: number): ImmState {
  const s = initState(z, R, velocityVar);
  return { models: [s, { x: [...s.x], P: s.P.map((r) => [...r]) }], mu: [0.9, 0.1] };
}

export function immPredict(s: ImmState, dt: number): ImmState {
  if (dt <= 0) return s;
  const leave = IMM_DWELL_S.map((tau) => 1 - Math.exp(-dt / tau));
  const T = [
    [1 - leave[0], leave[0]],
    [leave[1], 1 - leave[1]],
  ];
  const c = [0, 1].map((j) => T[0][j] * s.mu[0] + T[1][j] * s.mu[1]);
  const models = [0, 1].map((j) => {
    const w = [0, 1].map((i) => (T[i][j] * s.mu[i]) / c[j]);
    return predict(weightedSum(s.models, w), dt, IMM_PROCESS_NOISE[j]);
  });
  return { models, mu: c };
}

export function immUpdate(s: ImmState, z: Vec, R: Mat): ImmState {
  const lik = s.models.map((m) => {
    const { S, d2 } = innovation(m, z, R);
    const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
    return Math.exp(-d2 / 2) / (2 * Math.PI * Math.sqrt(Math.max(det, 1e-9)));
  });
  const raw = s.mu.map((m, j) => m * lik[j]);
  const total = raw[0] + raw[1];
  const mu = total > 1e-300 ? raw.map((v) => Math.min(Math.max(v / total, 1e-4), 1 - 1e-4)) : s.mu;
  return { models: s.models.map((m) => update(m, z, R)), mu };
}

export function immCombine(s: ImmState): KalmanState {
  return weightedSum(s.models, s.mu);
}
