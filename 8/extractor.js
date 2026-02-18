import { Vector3 } from "three";

class GraphRegionExtractor {
  constructor(vertices, edges) {
    // vertices: Array of THREE.Vector2
    // edges: Array of [index1, index2]
    this.vertices = vertices;
    this.edges = edges;
    this.wedges = []; // The list of wedges from Phase 1
    this.regions = []; // The list of regions from Phase 2
    this.log = []; // Execution log
  }

  addLog(msg) {
    this.log.push(msg);
    console.log(msg);
  }

  /**
   * Section 4.1: Phase one: finding all of the wedges
   *
   * A wedge is defined as two contiguous edges e1=(u,v) and e2=(v,w).
   * The algorithm creates a cycle of edges around every vertex sorted by angle,
   * then pairs consecutive edges to form wedges.
   */
  runPhaseOne() {
    this.addLog("--- PHASE 1: FINDING WEDGES ---");

    // Step 1: Duplicate undirected edge (vi, vj) to form two directed edges <vi, vj>
    // We organize these by the source vertex (vi) to handle the sorting in Step 3 easily.
    const adjacency = new Map();

    // Initialize lists for all vertices
    this.vertices.forEach((_, i) => adjacency.set(i, []));

    this.edges.forEach((edge) => {
      const [u, v] = edge;
      // Store target vertex 'v' in the list of 'u'
      adjacency.get(u).push(v);
      // Store target vertex 'u' in the list of 'v'
      adjacency.get(v).push(u);
    });

    // Step 2, 3, 4: Calculate angles, Sort, and Build Wedges
    adjacency.forEach((neighbors, uIdx) => {
      const uVec = this.vertices[uIdx];

      // Step 2 & 3: Calculate angle theta relative to horizontal line passing through u.
      // Sort list into ascending order using angle as key.
      const sortedNeighbors = neighbors
        .map((vIdx) => {
          const vVec = this.vertices[vIdx];
          // Vector pointing from u to v
          const dir = new Vector3().subVectors(vVec, uVec);
          // Math.atan2 returns angle in radians (-PI to PI)
          const angle = Math.atan2(dir.y, dir.x);
          return { id: vIdx, angle: angle };
        })
        .sort((a, b) => a.angle - b.angle);

      // Step 4: Combine consecutive entries to build a wedge.
      // "Link the last edge to the first one."
      const m = sortedNeighbors.length;
      for (let i = 0; i < m; i++) {
        // v_j is the neighbor at index i
        const vj = sortedNeighbors[i].id;
        // v_k is the neighbor at index i+1 (wrapping around)
        const vk = sortedNeighbors[(i + 1) % m].id;

        // A wedge is defined as (v_j, v_i, v_k)
        // Meaning: Enter v_i from v_j, turn, leave to v_k
        const wedge = {
          u: vj, // Previous vertex
          v: uIdx, // Central vertex (Pivot)
          w: vk, // Next vertex
          used: false,
          // Unique key to identify this wedge (Primary Key: u, Secondary Key: v)
          // In JS map lookups, a string key "u_v" is efficient.
          key: `${vj}_${uIdx}`,
        };

        this.wedges.push(wedge);
        this.addLog(`Found Wedge: (${wedge.u}, ${wedge.v}, ${wedge.w})`);
      }
    });

    this.addLog(`Total Wedges Found: ${this.wedges.length}`);
  }

  /**
   * Section 4.2: Phase two: grouping the wedges into regions
   *
   * We convert the grouping problem into a search problem.
   * We link wedge W1=(v1, v2, v3) to W2=(v2, v3, v4).
   */
  runPhaseTwo() {
    this.addLog("\n--- PHASE 2: GROUPING WEDGES ---");

    // Build a lookup map for O(1) access (Conceptually optimal like the binary search in paper)
    // Map Key: "u_v" -> returns the wedge that starts with edge u->v
    const wedgeMap = new Map();
    this.wedges.forEach((w) => {
      wedgeMap.set(w.key, w);
    });

    this.regions = [];

    // Step 1 in paper implies sorting, but iterating our Map/List serves the same purpose
    // for finding the "Next unused wedge".

    // Step 3: Find the next unused wedge W1
    for (let i = 0; i < this.wedges.length; i++) {
      let startWedge = this.wedges[i];

      if (startWedge.used) continue;

      // Start a new region
      const currentRegion = [];
      let currentWedge = startWedge;
      let cycleComplete = false;

      this.addLog(
        `Starting new region with wedge (${currentWedge.u}, ${currentWedge.v}, ${currentWedge.w})`,
      );

      // Traverse the cycle
      while (!cycleComplete) {
        // Mark W_i as used
        currentWedge.used = true;
        currentRegion.push(currentWedge);

        // Step 4: Search for wedge W_{i+1}
        // If W_i = (u, v, w), then W_{i+1} must be (v, w, x).
        // Key to find W_{i+1} is "v_w"
        const nextKey = `${currentWedge.v}_${currentWedge.w}`;
        const nextWedge = wedgeMap.get(nextKey);

        if (!nextWedge) {
          this.addLog(
            `Error: Broken topology. Could not find wedge starting with ${nextKey}`,
          );
          break;
        }

        // Step 5: Check connectivity
        if (nextWedge === startWedge) {
          cycleComplete = true;
          this.addLog("Cycle closed.");
        } else {
          currentWedge = nextWedge;
        }
      }

      // Store the region (sequence of vertices)
      // A region is represented by the pivot vertices of the wedges
      const regionVertices = currentRegion.map((w) => w.v);
      this.regions.push(regionVertices);
    }

    this.addLog(`\nTotal Regions Extracted: ${this.regions.length}`);
  }

  solve() {
    const startTime = performance.now();
    this.runPhaseOne();
    this.runPhaseTwo();

    // Remove the outer face (the region with the largest absolute area)
    let maxArea = 0;
    let maxIdx = -1;
    for (let r = 0; r < this.regions.length; r++) {
      const region = this.regions[r];
      let area = 0;
      for (let i = 0; i < region.length; i++) {
        const a = this.vertices[region[i]];
        const b = this.vertices[region[(i + 1) % region.length]];
        area += a.x * b.y - b.x * a.y;
      }
      if (Math.abs(area) > maxArea) {
        maxArea = Math.abs(area);
        maxIdx = r;
      }
    }
    if (maxIdx !== -1) {
      this.regions.splice(maxIdx, 1);
    }

    const endTime = performance.now();
    this.addLog(`\nAlgorithm Time: ${(endTime - startTime).toFixed(3)}ms`);
    return this.regions;
  }
}

export { GraphRegionExtractor };
