// Rope tension maths shared by the client (Rope) and the multiplayer server (server/server.mjs imports this file
// directly through Node's TypeScript type stripping, so it must stay import-free and use only erasable syntax).

/**
 * Tension (N) of an elastic spring-damper rope that only pulls.
 * dist: current distance between the hooks (m); rate: extension speed (m/s, + = separating);
 * EA: axial stiffness (N) = MBS / elongation at MBS; mEff: effective mass (kg) for mass-aware damping.
 */
export function ropeTension(dist: number, rate: number, restLength: number, EA: number, dampingRatio: number, mEff: number): number {
  const ext = dist - restLength;
  if (ext <= 0) return 0;
  const k = EA / Math.max(0.5, restLength);
  const c = 2 * dampingRatio * Math.sqrt(k * mEff);
  return Math.max(0, k * ext + c * rate);
}

/** m1 m2 / (m1 + m2), with Infinity meaning a fixed anchor */
export function effectiveMass(mA: number, mB: number): number {
  if (!Number.isFinite(mB)) return mA;
  if (!Number.isFinite(mA)) return mB;
  return (mA * mB) / (mA + mB);
}
