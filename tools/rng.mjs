// The seeded random draws both fixture generators use. Each generator calls seeded() once with its own seed and so has
// its own stream: the numbers depend only on that seed and on the order of the calls.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seeded(seed) {
  const rnd = mulberry32(seed);
  function shuffle(a) {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function pickWeighted(items, weights, k) {
    const pool = items.map((it, i) => ({ it, w: weights[i] }));
    const got = [];
    while (got.length < k && pool.length) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let r = rnd() * total, i = 0;
      while (r >= pool[i].w && i < pool.length - 1) { r -= pool[i].w; i++; }
      got.push(pool.splice(i, 1)[0].it);
    }
    return got;
  }
  return { rnd, shuffle, pickWeighted };
}
