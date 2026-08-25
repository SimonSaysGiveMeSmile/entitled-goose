// Keyframe tracks: arrays of [time, value] pairs sorted by time.
// Values interpolate with smoothstep by default — "pantomime" timing comes from
// authoring sparse keys with long holds, not from fancy easing.

export function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

export function evalTrack(track, t, ease = smoothstep) {
  if (track.length === 0) return 0;
  if (t <= track[0][0]) return track[0][1];
  const last = track[track.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < track.length; i++) {
    if (t < track[i][0]) {
      const [t0, v0] = track[i - 1];
      const [t1, v1] = track[i];
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * ease(u);
    }
  }
  return last[1];
}

// timeline: { paramName: track } → evaluated { paramName: value }
export function evalTimeline(timeline, t) {
  const out = {};
  for (const key of Object.keys(timeline)) out[key] = evalTrack(timeline[key], t);
  return out;
}

export function timelineDuration(timeline) {
  let d = 0;
  for (const key of Object.keys(timeline)) {
    const track = timeline[key];
    if (track.length) d = Math.max(d, track[track.length - 1][0]);
  }
  return d;
}
