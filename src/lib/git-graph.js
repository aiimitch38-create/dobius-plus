// Lane assignment for a topo-ordered commit list (newest first), the same
// row/lane model IDE git graphs use. Pure and renderer-agnostic so it can be
// unit-tested in plain Node; GitTreePanel turns the result into SVG.
//
// Input:  [{ hash, parents: [h...] }, ...] in topo order (children before parents).
// Output: rows aligned with the input: { lane, edges }, plus laneCount.
//   lane  = column of this commit's dot.
//   edges = segments to draw from THIS row down to the next row:
//           { from, to, kind } where from = lane at this row, to = lane at the
//           next row, kind = 'track' (a lane passing through / continuing) or
//           'branch' (a merge's extra parent peeling off this commit).
export function assignLanes(commits) {
  // active[i] = the commit hash lane i is waiting to reach (null = free).
  const active = [];
  const rows = [];

  for (const c of commits) {
    // Every lane currently expecting this hash converges here; the leftmost
    // becomes the commit's own lane, the rest free up (their edge visually
    // merges into this dot).
    const expecting = [];
    for (let i = 0; i < active.length; i += 1) if (active[i] === c.hash) expecting.push(i);

    let lane;
    if (expecting.length > 0) {
      lane = expecting[0];
      for (let k = 1; k < expecting.length; k += 1) active[expecting[k]] = null;
      // Converging lanes must CURVE into this dot: rewrite the previous row's
      // segments that ended on a freed lane so their bottom endpoint is this
      // commit's lane (otherwise those lines stop dead one row above the dot).
      const prev = rows[rows.length - 1];
      if (prev) {
        for (const e of prev.edges) {
          if (e.to !== lane && expecting.includes(e.to)) e.to = lane;
        }
      }
    } else {
      lane = active.indexOf(null);
      if (lane === -1) { lane = active.length; active.push(null); }
    }

    // This lane now tracks the FIRST parent (or frees if the commit is a root).
    const firstParent = c.parents[0] || null;
    active[lane] = firstParent;

    // Extra parents (merges): reuse a lane already expecting that parent,
    // otherwise allocate a fresh lane for it.
    const branchTargets = [];
    for (let p = 1; p < c.parents.length; p += 1) {
      const parent = c.parents[p];
      let target = active.indexOf(parent);
      if (target === -1) {
        target = active.indexOf(null);
        if (target === -1) { target = active.length; active.push(null); }
        active[target] = parent;
      }
      branchTargets.push(target);
    }

    // Trim trailing free lanes so laneCount stays honest.
    while (active.length && active[active.length - 1] === null) active.pop();

    // Edges drawn from this row toward the next: every occupied lane tracks
    // straight down; the merge fans out from this commit's dot.
    const edges = [];
    for (let i = 0; i < active.length; i += 1) {
      if (active[i] === null) continue;
      if (i === lane || branchTargets.includes(i)) {
        edges.push({ from: lane, to: i, kind: i === lane ? 'track' : 'branch' });
      } else {
        edges.push({ from: i, to: i, kind: 'track' });
      }
    }

    rows.push({ lane, edges });
  }

  const laneCount = rows.reduce((m, r) => Math.max(m, r.lane + 1, ...r.edges.map((e) => Math.max(e.from, e.to) + 1)), 1);
  return { rows, laneCount };
}
