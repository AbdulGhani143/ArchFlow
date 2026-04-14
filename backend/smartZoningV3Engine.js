/**
 * smartZoningV3Engine.js
 *
 * Third layout engine — "smart_zoning_v3"
 * Constraint-driven, zoning-first, graph-based layout system.
 * Fully deterministic (no AI calls).
 *
 * Exports: generateSmartLayout(rawInput)
 */

/* ═══════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════════════════════ */

const R = 2; // rounding digits
const GAJ_TO_SQFT = 9;
const MIN_GAJ = 60;
const MAX_GAJ = 400;

const SHAPE_RATIOS = { square: 1, rectangle: 0.78, "deep-rectangle": 0.62 };

// Room minimum dimensions in feet [width, height]
const MIN_SIZES = {
  "Master Bedroom":      [12, 14],
  "Bedroom":             [10, 12],
  "Living Room":         [12, 16],
  "Kitchen":             [8, 10],
  "Toilet":              [4, 7],
  "Master Attached Bath": [4, 7],
  "Attached Bath":       [4, 7],
  "Common Bathroom":     [4, 7],
  "Shaft":               [3, 4],
  "Dining":              [8, 10],
  "Hall":                [8, 10],
  "Entrance":            [4, 4],
  "Parking":             [10, 10],
  "Front Yard":          [6, 5],
  "Staircase":           [7, 8],
  "Balcony":             [4, 4],
  "Back Utility":        [6, 4],
  "Porch":               [6, 4],
};

const MAX_RATIOS = {
  "Master Bedroom": 1.6,
  "Bedroom":        1.8,
};

const CORRIDOR_MIN_WIDTH = 3; // feet

// Setback definitions (meters → feet)
const SETBACKS = {
  small:   { front: 1.5 * 3.281, sides: 0.9 * 3.281, rear: 1.2 * 3.281 },
  medium:  { front: 2.0 * 3.281, sides: 1.0 * 3.281, rear: 1.5 * 3.281 },
  large:   { front: 3.0 * 3.281, sides: 1.5 * 3.281, rear: 2.0 * 3.281 },
};

// Zone default percentages
const ZONE_DEFAULTS = {
  private: 0.40,
  semiPrivate: 0.22,
  public: 0.25,
  serviceWidth: 0.20,
};

// Scoring weights
const SCORE_WEIGHTS = {
  zoning: 0.30,
  flow: 0.25,
  light: 0.20,
  privacy: 0.15,
  compactness: 0.10,
};

function round(v) { return Math.round(v * 10 ** R) / 10 ** R; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function createError(msg) {
  const e = new Error(msg);
  e.code = "NOT_POSSIBLE";
  return e;
}

function makeRoom(id, type, zone, x, y, w, h, extra = {}) {
  return {
    id, type, zone,
    x: round(x), y: round(y),
    width: round(w), height: round(h),
    ventilation: "none",
    openToHall: false,
    ...extra,
  };
}

/* ═══════════════════════════════════════════════════════════
   INPUT HANDLING
   ═══════════════════════════════════════════════════════════ */

function normalizeInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw createError("Layout input must be a JSON object.");

  const sw = Number(raw.plotWidth), sh = Number(raw.plotHeight);
  const derivedGaj = Number.isFinite(sw) && Number.isFinite(sh) ? (sw * sh) / GAJ_TO_SQFT : NaN;
  const plotGaj = Number(raw.plotGaj ?? derivedGaj);
  const plotShape = raw.plotShape ?? (
    Number.isFinite(sw) && Number.isFinite(sh) ? deriveShape(sw / sh) : "rectangle"
  );

  return {
    plotGaj, plotShape,
    rawW: sw, rawH: sh,
    dwellingType: raw.dwellingType ?? "house",
    bedrooms: clamp(Number(raw.bedrooms ?? 3), 1, 6),
    bathrooms: clamp(Number(raw.bathrooms ?? 2), 1, 4),
    frontDirection: String(raw.frontDirection ?? "south").toLowerCase(),
    boundaries: raw.boundaries ?? {},
    vastuMode: raw.vastuMode === true,
  };
}

function deriveShape(r) {
  const n = r > 1 ? 1 / r : r;
  if (n >= 0.9) return "square";
  if (n >= 0.7) return "rectangle";
  return "deep-rectangle";
}

function validateInput(inp) {
  if (!Number.isFinite(inp.plotGaj) || inp.plotGaj < MIN_GAJ || inp.plotGaj > MAX_GAJ)
    throw createError(`plotGaj must be between ${MIN_GAJ} and ${MAX_GAJ}.`);
  if (!["square", "rectangle", "deep-rectangle"].includes(inp.plotShape))
    throw createError("Invalid plotShape.");
  if (!["house", "flat"].includes(inp.dwellingType))
    throw createError("Invalid dwellingType.");
  if (!Number.isInteger(inp.bedrooms) || inp.bedrooms < 1 || inp.bedrooms > 6)
    throw createError("bedrooms must be 1-6.");
  if (!Number.isInteger(inp.bathrooms) || inp.bathrooms < 1 || inp.bathrooms > 4)
    throw createError("bathrooms must be 1-4.");
  if (!["north", "south", "east", "west"].includes(inp.frontDirection))
    throw createError("frontDirection must be north, south, east, or west.");
}

function derivePlotDimensions(gaj, shape, rawW, rawH, frontDirection) {
  const dir = String(frontDirection ?? "south").toLowerCase();
  const shouldSwap = dir === "east" || dir === "west";

  if (Number.isFinite(rawW) && Number.isFinite(rawH) && rawW > 0 && rawH > 0) {
    const width = shouldSwap ? rawH : rawW;
    const height = shouldSwap ? rawW : rawH;
    return { width, height, areaSqFt: rawW * rawH };
  }

  const area = gaj * GAJ_TO_SQFT;
  const ratio = SHAPE_RATIOS[shape] ?? 0.78;
  const baseW = Math.sqrt(area * ratio);
  const baseH = area / baseW;
  const width = shouldSwap ? baseH : baseW;
  const height = shouldSwap ? baseW : baseH;
  return { width, height, areaSqFt: area };
}

function resolveTier(gaj) {
  if (gaj <= 150) return "compact";
  if (gaj <= 250) return "standard";
  return "large";
}

/* ═══════════════════════════════════════════════════════════
   STEP 0 — SETBACKS
   ═══════════════════════════════════════════════════════════ */

function applySetbacks(plotW, plotH, gaj) {
  let sb;
  if (gaj < 100) sb = SETBACKS.small;
  else if (gaj <= 200) sb = SETBACKS.medium;
  else sb = SETBACKS.large;

  const x = round(sb.sides);
  const y = round(sb.rear);
  const w = round(plotW - 2 * sb.sides);
  const h = round(plotH - sb.front - sb.rear);

  if (w < 15 || h < 15) throw createError("Minimum required area exceeded for the requested configuration.");

  return { x, y, width: w, height: h };
}

/* ═══════════════════════════════════════════════════════════
   BOUNDARY MAPPING
   ═══════════════════════════════════════════════════════════ */

function mapEdges(boundaries, frontDir) {
  if (!boundaries || typeof boundaries !== "object")
    return { left: "covered", right: "covered", back: "covered" };

  const dir = String(frontDir ?? "south").toLowerCase();
  const opp = { north: "south", south: "north", east: "west", west: "east" };
  let leftDir, rightDir;

  switch (dir) {
    case "south": leftDir = "west"; rightDir = "east"; break;
    case "north": leftDir = "east"; rightDir = "west"; break;
    case "east":  leftDir = "south"; rightDir = "north"; break;
    case "west":  leftDir = "north"; rightDir = "south"; break;
    default:      leftDir = "west"; rightDir = "east";
  }

  return {
    left:  boundaries[leftDir] === "open" ? "open" : "covered",
    right: boundaries[rightDir] === "open" ? "open" : "covered",
    back:  boundaries[opp[dir]] === "open" ? "open" : "covered",
  };
}

/* ═══════════════════════════════════════════════════════════
   STEP 1 — ZONING (Fixed-Band)
   ═══════════════════════════════════════════════════════════ */

function createZones(ba, serviceSide, ratios) {
  const pct = { ...ZONE_DEFAULTS, ...ratios };

  const depthSum = pct.private + pct.semiPrivate + pct.public;
  const normP = pct.private / depthSum;
  const normSP = pct.semiPrivate / depthSum;

  const privateH = round(ba.height * normP);
  const semiPrivateH = round(ba.height * normSP);
  const publicH = round(ba.height - privateH - semiPrivateH);

  const serviceW = round(ba.width * clamp(pct.serviceWidth, 0.12, 0.30));
  const serviceX = serviceSide === "right" ? round(ba.x + ba.width - serviceW) : ba.x;

  const privateY = ba.y;
  const semiPrivateY = round(ba.y + privateH);
  const publicY = round(ba.y + privateH + semiPrivateH);

  return {
    private:     { x: ba.x, y: privateY, w: ba.width, h: privateH },
    semiPrivate: { x: ba.x, y: semiPrivateY, w: ba.width, h: semiPrivateH },
    public:      { x: ba.x, y: publicY, w: ba.width, h: publicH },
    service:     { x: serviceX, y: semiPrivateY, w: serviceW, h: semiPrivateH + publicH },
  };
}

/* ═══════════════════════════════════════════════════════════
   STEP 4 — SERVICE CORE CLUSTER
   ═══════════════════════════════════════════════════════════ */

function placeServiceCore(zones, numBaths, attachedBathCount) {
  const sz = zones.service;
  const rooms = [];

  const shaftW = 3, shaftH = 4;
  const kitchenW = Math.min(round(sz.w), 10);
  const kitchenH = clamp(round(sz.h * 0.50), 8, 12);
  const commonBathH = clamp(round(sz.h * 0.30), 5, 8);
  const sharedBaths = Math.max(0, numBaths - attachedBathCount);

  let curY = sz.y;

  rooms.push(makeRoom("kitchen", "Kitchen", "Service", sz.x, curY, kitchenW, kitchenH, { openToHall: true }));
  curY += kitchenH;

  rooms.push(makeRoom("shaft", "Shaft", "Service", sz.x, curY, shaftW, shaftH));

  if (sharedBaths > 0) {
    const cbX = sz.x + shaftW;
    const cbW = Math.max(4, sz.w - shaftW);
    rooms.push(makeRoom("common_bath", "Common Bathroom", "Service", cbX, curY, cbW, commonBathH));
  }

  return rooms;
}

/* ═══════════════════════════════════════════════════════════
   STEP 2a — HOUSE LAYOUT
   ═══════════════════════════════════════════════════════════ */

function buildHouseLayout(ba, zones, input, tier, edges, serviceSide, entranceAlign) {
  const rooms = [];
  const W = ba.width;
  const isLarge = tier === "large";
  const numBeds = input.bedrooms;
  const numBaths = input.bathrooms;
  const attachedBathCount = Math.max(0, Math.min(numBeds, numBaths - 1));

  /* ─── PUBLIC ZONE: entrance + living as full-height block ─── */
  const pubZ = zones.public;
  const nonServiceW = round(W - zones.service.w);
  const livingX = serviceSide === "right" ? pubZ.x : round(pubZ.x + zones.service.w);

  // Entrance (porch) as a strip at the very bottom of public zone
  const porchW = clamp(W * 0.30, 6, 14);
  const porchH = clamp(pubZ.h * 0.30, 4, 6);
  const porchX = entranceAlign === "centered"
    ? round(pubZ.x + (W - porchW) / 2)
    : round(pubZ.x + W * 0.05);
  const porchY = round(pubZ.y + pubZ.h - porchH);

  rooms.push(makeRoom("entrance", "Entrance", "Public", porchX, porchY, porchW, porchH));

  // Living room fills the rest of the public zone (non-service side)
  // It spans from pubZ.y to the top of porch, ensuring adjacency
  const livingH = round(porchY - pubZ.y);
  if (livingH >= 6 && nonServiceW >= 10) {
    rooms.push(makeRoom("living", "Living Room", "Public",
      livingX, pubZ.y, nonServiceW, livingH, { openToHall: true }));
  } else {
    // Fallback: living fills entire public zone height on non-service side
    rooms.push(makeRoom("living", "Living Room", "Public",
      livingX, pubZ.y, nonServiceW, pubZ.h, { openToHall: true }));
  }

  // Parking / front yard — placed alongside entrance (same Y band)
  if (isLarge) {
    const parkW = clamp(W * 0.4, 10, 18);
    const parkX = porchX + porchW;
    const avail = ba.x + W - parkX;
    if (avail >= 8) {
      rooms.push(makeRoom("parking", "Parking", "Outdoor",
        parkX, porchY, Math.min(parkW, avail), porchH));
    }
  } else if (tier === "standard") {
    const yardW = round(W - porchW - 1);
    if (yardW > 4) {
      const yardX = porchX + porchW;
      const avail = ba.x + W - yardX;
      if (avail > 4) {
        rooms.push(makeRoom("front_yard", "Front Yard", "Outdoor",
          yardX, porchY, Math.min(yardW, avail), porchH));
      }
    }
  }

  /* ─── SEMI-PRIVATE ZONE: dining + hall ─── */
  const spZ = zones.semiPrivate;
  const spNonServiceW = nonServiceW;
  const spX = serviceSide === "right" ? spZ.x : round(spZ.x + zones.service.w);

  const diningW = clamp(spNonServiceW * 0.45, 8, 14);
  const diningH = spZ.h; // fill full semi-private height
  rooms.push(makeRoom("dining", "Dining", "Semi-private",
    spX, spZ.y, diningW, diningH, { openToHall: true }));

  const hallActualW = round(spNonServiceW - diningW);
  if (hallActualW >= 5) {
    rooms.push(makeRoom("hall", "Hall", "Semi-private",
      round(spX + diningW), spZ.y, hallActualW, diningH,
      { openToHall: true, circulationWidth: round(hallActualW) }));
  }

  /* ─── SERVICE CORE ─── */
  const serviceRooms = placeServiceCore(zones, numBaths, attachedBathCount);
  rooms.push(...serviceRooms);

  /* ─── PRIVATE ZONE: bedrooms + attached baths ─── */
  const pvZ = zones.private;
  const aBathW = 5;
  const aBathH = 7;

  // Bedrooms always start at the rear wall for ventilation
  let bedZoneY = pvZ.y;
  let bedZoneH = pvZ.h;

  const maxBedsInBand = Math.min(numBeds, Math.floor(pvZ.w / 10), 4);
  let bedsInBand = maxBedsInBand;
  let bedsInSide = numBeds - bedsInBand;

  const bandBathCount = Math.min(attachedBathCount, bedsInBand);
  const totalBathW = bandBathCount * aBathW;
  const bedAvailW = pvZ.w - totalBathW;
  const perBedW = round(bedAvailW / bedsInBand);

  let curX = pvZ.x;
  for (let i = 0; i < bedsInBand; i++) {
    const isMaster = i === 0;
    const bedId = isMaster ? "bed_1" : `bed_${i + 1}`;
    const bedType = isMaster ? "Master Bedroom" : `Bedroom ${i + 1}`;

    let bedW;
    if (i === bedsInBand - 1) {
      // Last bed: fill remaining width minus remaining bath slots
      const remainingBaths = Math.max(0, bandBathCount - (i + 1)) * aBathW;
      const thisBath = i < bandBathCount ? aBathW : 0;
      bedW = round(pvZ.x + pvZ.w - curX - remainingBaths - thisBath);
    } else {
      bedW = isMaster ? clamp(round(perBedW * 1.15), 12, 16) : clamp(perBedW, 10, 14);
    }

    bedW = Math.max(10, bedW);
    rooms.push(makeRoom(bedId, bedType, "Private", curX, bedZoneY, bedW, bedZoneH));
    curX += bedW;

    if (i < bandBathCount) {
      const abId = isMaster ? "attached_bath_1" : `attached_bath_${i + 1}`;
      const abType = isMaster ? "Master Attached Bath" : `Attached Bath ${i + 1}`;
      rooms.push(makeRoom(abId, abType, "Service",
        curX, bedZoneY, aBathW, Math.min(aBathH, bedZoneH)));
      curX += aBathW;
    }
  }

  // Side column overflow bedrooms
  if (bedsInSide > 0) {
    const sideOnLeft = serviceSide === "right";
    const sideColW = clamp(W * 0.25, 10, 14);
    const sideX = sideOnLeft ? ba.x : round(ba.x + W - sideColW);
    const sideH = spZ.h;
    const perSideBedH = round(sideH / bedsInSide);

    for (let i = 0; i < bedsInSide; i++) {
      const idx = bedsInBand + i;
      const bedH = (i === bedsInSide - 1) ? round(sideH - i * perSideBedH) : perSideBedH;
      rooms.push(makeRoom(`bed_${idx + 1}`, `Bedroom ${idx + 1}`, "Private",
        sideX, round(spZ.y + i * perSideBedH), sideColW, bedH));
    }
  }

  return rooms;
}

/* ═══════════════════════════════════════════════════════════
   STEP 2b — FLAT LAYOUT (Core-Based)
   ═══════════════════════════════════════════════════════════ */

function buildFlatLayout(ba, input, serviceSide, entranceAlign) {
  const rooms = [];
  const W = ba.width;
  const H = ba.height;
  const numBeds = input.bedrooms;
  const numBaths = input.bathrooms;
  const attachedBathCount = Math.max(0, Math.min(numBeds, numBaths - 1));

  /* ─── Service core dimensions ─── */
  const serviceW = clamp(round(W * 0.22), 8, 13);
  const serviceX = serviceSide === "right" ? round(ba.x + W - serviceW) : ba.x;
  const nonServiceW = round(W - serviceW);
  const nonServiceX = serviceSide === "right" ? ba.x : round(ba.x + serviceW);

  const shaftW = 3, shaftH = 5;
  const kitchenW = serviceW;
  const kitchenH = clamp(round(H * 0.22), 8, 12);
  const commonBathW = round(serviceW - shaftW);
  const commonBathH = clamp(round(H * 0.14), 5, 8);

  /* ─── Entry at front (bottom) ─── */
  const entryH = clamp(round(H * 0.12), 4, 7);
  const entryY = round(ba.y + H - entryH);
  rooms.push(makeRoom("entrance", "Entrance", "Public",
    nonServiceX, entryY, nonServiceW, entryH));

  /* ─── Living/Dining hub ─── */
  const livingH = clamp(round(H * 0.28), 10, 18);
  const livingY = round(entryY - livingH);
  rooms.push(makeRoom("living", "Living Room", "Public",
    nonServiceX, livingY, nonServiceW, livingH, { openToHall: true }));

  /* ─── Service core: kitchen → shaft+bath vertically ─── */
  // Place kitchen adjacent to living, shaft+bath below kitchen
  const coreTopY = livingY;  // kitchen starts at same height as living
  rooms.push(makeRoom("kitchen", "Kitchen", "Service",
    serviceX, coreTopY, kitchenW, kitchenH, { openToHall: true }));

  const shaftBathY = round(coreTopY + kitchenH);
  rooms.push(makeRoom("shaft", "Shaft", "Service",
    serviceX, shaftBathY, shaftW, shaftH));
  rooms.push(makeRoom("common_bath", "Common Bathroom", "Service",
    round(serviceX + shaftW), shaftBathY, commonBathW, commonBathH));

  // Fill the remaining service column area below shaft/bath to entry
  const serviceBottomY = round(shaftBathY + Math.max(shaftH, commonBathH));
  const serviceRemainH = round(entryY - serviceBottomY);
  if (serviceRemainH >= 4) {
    // Can add an additional service room or extend entry alongside service
    // Add as corridor/lobby extension on service side
  }

  /* ─── Bedrooms on top (external walls) ─── */
  const bedroomTopY = ba.y;
  const bedroomH = round(livingY - ba.y);
  const aBathW = 5, aBathH = Math.min(7, bedroomH);

  if (numBeds === 1) {
    rooms.push(makeRoom("bed_1", "Master Bedroom", "Private",
      ba.x, bedroomTopY, W, bedroomH));
    if (attachedBathCount >= 1) {
      const abX = serviceSide === "right" ? round(ba.x + W - aBathW) : ba.x;
      rooms.push(makeRoom("attached_bath_1", "Master Attached Bath", "Service",
        abX, bedroomTopY, aBathW, aBathH));
    }
  } else {
    // Distribute bedrooms across top, each touching an external wall
    const totalBathW = Math.min(attachedBathCount, numBeds) * aBathW;
    const bedTotalW = W - totalBathW;
    const perBedW = round(bedTotalW / numBeds);

    let curX = ba.x;
    for (let i = 0; i < numBeds; i++) {
      const isMaster = i === 0;
      const bedId = isMaster ? "bed_1" : `bed_${i + 1}`;
      const bedType = isMaster ? "Master Bedroom" : `Bedroom ${i + 1}`;
      const hasBath = i < attachedBathCount;

      let bedW;
      if (i === numBeds - 1) {
        bedW = round(ba.x + W - curX - (hasBath ? aBathW : 0));
      } else {
        bedW = isMaster ? clamp(round(perBedW * 1.1), 10, 16) : clamp(perBedW, 10, 14);
      }
      bedW = Math.max(8, bedW);

      rooms.push(makeRoom(bedId, bedType, "Private",
        curX, bedroomTopY, bedW, bedroomH));
      curX += bedW;

      if (hasBath) {
        const abId = isMaster ? "attached_bath_1" : `attached_bath_${i + 1}`;
        const abType = isMaster ? "Master Attached Bath" : `Attached Bath ${i + 1}`;
        rooms.push(makeRoom(abId, abType, "Service",
          curX, bedroomTopY, aBathW, aBathH));
        curX += aBathW;
      }
    }
  }

  /* ─── Balcony (mandatory for flats) ─── */
  // Place on the opposite side from service, adjacent to living room's outer edge
  const balconyW = 5;
  const balconyH = clamp(livingH * 0.4, 4, 8);
  const balcExternalX = serviceSide === "right" ? ba.x : round(ba.x + W - balconyW);
  const balcOverlapsLiving = (balcExternalX >= nonServiceX && balcExternalX < nonServiceX + nonServiceW);

  if (balcOverlapsLiving) {
    // Shrink living to make room for balcony
    const shrunkLivingRoom = rooms.find(rm => rm.id === "living");
    if (shrunkLivingRoom) {
      if (serviceSide === "right") {
        // Living starts at ba.x, balcony at ba.x → shift living right
        shrunkLivingRoom.x = round(ba.x + balconyW);
        shrunkLivingRoom.width = round(shrunkLivingRoom.width - balconyW);
      } else {
        // Living extends to right edge, balcony at right → shrink living width
        shrunkLivingRoom.width = round(shrunkLivingRoom.width - balconyW);
      }
    }
  }

  rooms.push(makeRoom("balcony_1", "Balcony", "Outdoor",
    balcExternalX, livingY, balconyW, balconyH));

  return rooms;
}

/* ═══════════════════════════════════════════════════════════
   STEP 3 — FLOW / ADJACENCY GRAPH
   ═══════════════════════════════════════════════════════════ */

function buildAdjacencyGraph(rooms) {
  const graph = {};
  for (const r of rooms) graph[r.id] = [];

  const TOL = 1.5; // increased tolerance for rounding alignment
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      if (areAdjacent(a, b, TOL)) {
        graph[a.id].push(b.id);
        graph[b.id].push(a.id);
      }
    }
  }
  return graph;
}

function areAdjacent(a, b, tol) {
  const ax2 = a.x + a.width, ay2 = a.y + a.height;
  const bx2 = b.x + b.width, by2 = b.y + b.height;

  const hOverlap = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  const vOverlap = Math.min(ay2, by2) - Math.max(a.y, b.y);

  // Share vertical edge (side by side)
  if (Math.abs(ax2 - b.x) < tol || Math.abs(bx2 - a.x) < tol) {
    if (vOverlap > 1) return true;
  }
  // Share horizontal edge (top/bottom)
  if (Math.abs(ay2 - b.y) < tol || Math.abs(by2 - a.y) < tol) {
    if (hOverlap > 1) return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════
   STEP 7 — CIRCULATION VALIDATION
   ═══════════════════════════════════════════════════════════ */

function validateLayout(rooms, graph, dwellingType) {
  const errors = [];

  const entrance = rooms.find(r => r.type === "Entrance" || r.id === "entrance");
  if (!entrance) {
    errors.push("no_entrance");
    return { valid: false, errors, connected: false, hallSegments: 0 };
  }

  // BFS reachability
  const visited = new Set();
  const queue = [entrance.id];
  visited.add(entrance.id);
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const neighbor of (graph[cur] || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  const unreachable = rooms.filter(r => !visited.has(r.id));
  if (unreachable.length > 0) errors.push("unreachable_rooms");

  // Bedroom directly accessible from entrance
  const entranceNeighbors = graph[entrance.id] || [];
  for (const nid of entranceNeighbors) {
    const nr = rooms.find(r => r.id === nid);
    if (nr && (nr.type.includes("Bedroom") || nr.type === "Master Bedroom")) {
      errors.push("bedroom_direct_from_entrance");
      break;
    }
  }

  // Bedroom-to-bedroom traversal
  const bedrooms = rooms.filter(r => r.type.includes("Bedroom") || r.type === "Master Bedroom");
  for (const bed of bedrooms) {
    const neighbors = graph[bed.id] || [];
    const nonBedNeighbors = neighbors.filter(nid => {
      const nr = rooms.find(r => r.id === nid);
      return nr && !nr.type.includes("Bedroom") && nr.type !== "Master Bedroom";
    });
    // Only a problem if this bedroom ONLY exits through other bedrooms
    if (neighbors.length > 0 && nonBedNeighbors.length === 0) {
      errors.push("bedroom_only_exit_through_bedroom");
      break;
    }
  }

  // Service clustering
  const serviceRooms = rooms.filter(r =>
    r.type === "Kitchen" || r.type === "Shaft" ||
    r.type === "Common Bathroom");
  if (serviceRooms.length >= 2) {
    for (const sr of serviceRooms) {
      const neighbors = graph[sr.id] || [];
      const serviceNeighbors = neighbors.filter(nid => serviceRooms.some(s => s.id === nid));
      if (serviceNeighbors.length === 0) {
        errors.push("service_not_clustered");
        break;
      }
    }
  }

  // Flat-specific
  if (dwellingType === "flat") {
    if (!rooms.find(r => r.type === "Shaft")) errors.push("flat_no_shaft");
    if (!rooms.find(r => r.type === "Balcony")) errors.push("flat_no_balcony");
  }

  const hallRooms = rooms.filter(r =>
    r.type === "Hall" || r.type === "Living Room" || r.type === "Entrance");

  return {
    valid: errors.length === 0,
    errors,
    connected: unreachable.length === 0,
    hallSegments: hallRooms.length,
  };
}

/* ═══════════════════════════════════════════════════════════
   STEP 8 — LIGHT & VENTILATION
   ═══════════════════════════════════════════════════════════ */

function tagVentilation(rooms, ba) {
  const warnings = [];
  const baRight = ba.x + ba.width;
  const baBottom = ba.y + ba.height;
  const TOL = 1.0;

  for (const r of rooms) {
    const touchesLeft   = Math.abs(r.x - ba.x) < TOL;
    const touchesRight  = Math.abs((r.x + r.width) - baRight) < TOL;
    const touchesTop    = Math.abs(r.y - ba.y) < TOL;
    const touchesBottom = Math.abs((r.y + r.height) - baBottom) < TOL;

    const externalEdges = [touchesLeft, touchesRight, touchesTop, touchesBottom].filter(Boolean).length;

    if (externalEdges >= 2) r.ventilation = "cross";
    else if (externalEdges === 1) r.ventilation = "single";
    else r.ventilation = "none";

    const isBedroom = r.type.includes("Bedroom") || r.type === "Master Bedroom";
    const isHabitable = isBedroom || ["Living Room", "Kitchen", "Dining", "Hall"].includes(r.type);

    if (isHabitable && r.ventilation === "none") {
      warnings.push(`${r.type} (${r.id}) has no external wall contact`);
    }
    if ((r.type.includes("Bath") || r.type.includes("Toilet")) && r.ventilation === "none") {
      warnings.push(`${r.type} (${r.id}) has no ventilation`);
    }
  }

  return warnings;
}

/* ═══════════════════════════════════════════════════════════
   STEP 9 — PRIVACY CHECKS
   ═══════════════════════════════════════════════════════════ */

function checkPrivacy(rooms) {
  let privacyScore = 1.0;

  const entrance = rooms.find(r => r.type === "Entrance" || r.id === "entrance");
  if (!entrance) return privacyScore;

  const eCX = entrance.x + entrance.width / 2;
  const eCY = entrance.y + entrance.height / 2;

  const bedrooms = rooms.filter(r => r.type.includes("Bedroom") || r.type === "Master Bedroom");
  const opaqueRooms = rooms.filter(r =>
    r.type !== "Hall" && r.type !== "Entrance" && r.id !== "entrance" &&
    !r.type.includes("Bedroom") && r.type !== "Balcony" && r.type !== "Front Yard");

  for (const bed of bedrooms) {
    const bCX = bed.x + bed.width / 2;
    const bCY = bed.y + bed.height / 2;
    let blocked = false;
    for (const wall of opaqueRooms) {
      if (lineIntersectsRect(eCX, eCY, bCX, bCY, wall)) { blocked = true; break; }
    }
    if (!blocked) privacyScore -= 0.15;
  }

  const living = rooms.find(r => r.type === "Living Room");
  const toilets = rooms.filter(r => r.type.includes("Bath") || r.type === "Common Bathroom");
  if (living) {
    for (const toilet of toilets) {
      if (edgesDirectlyFacing(toilet, living)) privacyScore -= 0.10;
    }
  }

  return Math.max(0, privacyScore);
}

function lineIntersectsRect(x1, y1, x2, y2, rect) {
  return lineSegClipsRect(x1, y1, x2, y2, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
}

function lineSegClipsRect(x1, y1, x2, y2, left, top, right, bottom) {
  let tmin = 0, tmax = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - left], [dx, right - x1], [-dy, y1 - top], [dy, bottom - y1]]) {
    if (Math.abs(p) < 1e-10) { if (q < 0) return false; }
    else { const t = q / p; if (p < 0) { if (t > tmax) return false; tmin = Math.max(tmin, t); } else { if (t < tmin) return false; tmax = Math.min(tmax, t); } }
  }
  return tmin <= tmax;
}

function edgesDirectlyFacing(a, b) {
  const TOL = 1.0;
  const ax2 = a.x + a.width, bx2 = b.x + b.width;
  const ay2 = a.y + a.height, by2 = b.y + b.height;
  const vOverlap = Math.min(ay2, by2) - Math.max(a.y, b.y);
  const hOverlap = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  if (vOverlap > 2 && (Math.abs(ax2 - b.x) < TOL || Math.abs(bx2 - a.x) < TOL)) return true;
  if (hOverlap > 2 && (Math.abs(ay2 - b.y) < TOL || Math.abs(by2 - a.y) < TOL)) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════════
   STEP 10 — VASTU MODE
   ═══════════════════════════════════════════════════════════ */

function applyVastu(rooms, ba) {
  let vastuScore = 0;
  const baCX = ba.x + ba.width / 2;
  const baCY = ba.y + ba.height / 2;
  for (const r of rooms) {
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (r.type === "Living Room" && (cy < baCY || cx > baCX)) vastuScore += 0.25;
    else if (r.type === "Kitchen" && cx > baCX && cy > baCY) vastuScore += 0.25;
    else if (r.type === "Master Bedroom" && cx < baCX && cy > baCY) vastuScore += 0.25;
  }
  return Math.min(1.0, vastuScore);
}

/* ═══════════════════════════════════════════════════════════
   VALIDATION HELPERS
   ═══════════════════════════════════════════════════════════ */

function validateBounds(rooms, ba) {
  for (const r of rooms) {
    if (r.x < ba.x - 0.5 || r.y < ba.y - 0.5 ||
        r.x + r.width > ba.x + ba.width + 0.5 ||
        r.y + r.height > ba.y + ba.height + 0.5) return false;
    if (r.width <= 0 || r.height <= 0) return false;
  }
  return true;
}

function validateNoOverlap(rooms) {
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) return false;
    }
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════
   STEP 6 — SCORING
   ═══════════════════════════════════════════════════════════ */

function scoreLayout(rooms, zones, ba, graph, validation, ventWarnings, dwellingType, vastuMode) {
  let zoning = 1.0, flow = 1.0, light = 1.0;
  let privacy = checkPrivacy(rooms);
  let compactness = 1.0;

  // Zoning: check rooms are in correct zones
  if (zones.private) {
    for (const r of rooms) {
      const rCY = r.y + r.height / 2;
      if (r.zone === "Private" && (rCY < zones.private.y - 1 || rCY > zones.private.y + zones.private.h + 1)) zoning -= 0.05;
      if (r.zone === "Public" && zones.public && (rCY < zones.public.y - 1 || rCY > zones.public.y + zones.public.h + 1)) zoning -= 0.05;
    }
  }

  // Flow
  if (!validation.connected) flow -= 0.5;
  if (validation.errors.includes("bedroom_direct_from_entrance")) flow -= 0.3;
  if (validation.errors.includes("bedroom_only_exit_through_bedroom")) flow -= 0.2;

  // Light
  const habitable = rooms.filter(r =>
    r.type.includes("Bedroom") || r.type === "Living Room" || r.type === "Kitchen" || r.type === "Dining");
  const noVent = habitable.filter(r => r.ventilation === "none").length;
  light -= (noVent / Math.max(1, habitable.length)) * 0.8;

  // Compactness
  const totalRoomArea = rooms.reduce((sum, r) => sum + r.width * r.height, 0);
  const buildableTotal = ba.width * ba.height;
  const deadSpace = Math.max(0, buildableTotal - totalRoomArea);
  const deadRatio = deadSpace / buildableTotal;
  compactness = 1.0 - Math.min(1.0, deadRatio * 3);

  let vastuBonus = 0;
  if (vastuMode) vastuBonus = applyVastu(rooms, ba) * 0.1;

  const score = round(Math.max(0, Math.min(1,
    SCORE_WEIGHTS.zoning * Math.max(0, zoning) +
    SCORE_WEIGHTS.flow * Math.max(0, flow) +
    SCORE_WEIGHTS.light * Math.max(0, light) +
    SCORE_WEIGHTS.privacy * Math.max(0, privacy) +
    SCORE_WEIGHTS.compactness * Math.max(0, compactness) +
    vastuBonus
  )));

  return { score, deadSpace: round(deadSpace) };
}

/* ═══════════════════════════════════════════════════════════
   STEP 6 — CANDIDATE GENERATION
   ═══════════════════════════════════════════════════════════ */

function generateCandidates(ba, input, tier, edges) {
  const isFlat = input.dwellingType === "flat";

  const serviceSides = ["left", "right"];
  const entranceAligns = ["centered", "offset-left"];

  const zoneRatios = isFlat ? [null] : [
    { private: 0.40, semiPrivate: 0.22, public: 0.25, serviceWidth: 0.20 },
    { private: 0.44, semiPrivate: 0.20, public: 0.23, serviceWidth: 0.20 },
    { private: 0.36, semiPrivate: 0.24, public: 0.27, serviceWidth: 0.20 },
  ];
  const bedDistributions = isFlat ? ["back-cluster"] : ["back-cluster", "split"];

  const candidates = [];

  for (const serviceSide of serviceSides) {
    for (const entranceAlign of entranceAligns) {
      for (const ratios of zoneRatios) {
        for (const bedDist of bedDistributions) {
          try {
            let rooms;

            if (isFlat) {
              rooms = buildFlatLayout(ba, input, serviceSide, entranceAlign);
            } else {
              const zones = createZones(ba, serviceSide, ratios);
              rooms = buildHouseLayout(ba, zones, input, tier, edges, serviceSide, entranceAlign);
            }

            // Sanitize: clamp rooms within buildable area
            for (const r of rooms) {
              r.x = round(Math.max(ba.x, r.x));
              r.y = round(Math.max(ba.y, r.y));
              r.width = round(Math.min(r.width, ba.x + ba.width - r.x));
              r.height = round(Math.min(r.height, ba.y + ba.height - r.y));
            }

            rooms = rooms.filter(r => r.width > 0.5 && r.height > 0.5);

            if (!validateBounds(rooms, ba)) continue;

            const ventWarnings = tagVentilation(rooms, ba);
            const graph = buildAdjacencyGraph(rooms);
            const validation = validateLayout(rooms, graph, input.dwellingType);

            // Hard rejection: connectivity
            if (!validation.connected) continue;

            // Hard rejection: flat-specific
            if (isFlat) {
              if (validation.errors.includes("flat_no_shaft")) continue;
              if (validation.errors.includes("flat_no_balcony")) continue;
              const bedrooms = rooms.filter(r => r.type.includes("Bedroom") || r.type === "Master Bedroom");
              if (bedrooms.some(r => r.ventilation === "none")) continue;
            }

            // Score (soft penalties for other validation errors)
            const zones = isFlat ? {} : createZones(ba, serviceSide, ratios);
            const { score, deadSpace } = scoreLayout(
              rooms, zones, ba, graph, validation, ventWarnings,
              input.dwellingType, input.vastuMode
            );

            candidates.push({
              rooms, graph, validation, ventWarnings,
              score, deadSpace, serviceSide, entranceAlign,
            });
          } catch {
            continue;
          }
        }
      }
    }
  }

  return candidates;
}

/* ═══════════════════════════════════════════════════════════
   MAIN ORCHESTRATOR
   ═══════════════════════════════════════════════════════════ */

export function generateSmartLayout(rawInput) {
  const input = normalizeInput(rawInput);
  validateInput(input);

  const plot = derivePlotDimensions(input.plotGaj, input.plotShape, input.rawW, input.rawH, input.frontDirection);
  const tier = resolveTier(input.plotGaj);
  const edges = mapEdges(input.boundaries, input.frontDirection);
  const ba = applySetbacks(plot.width, plot.height, input.plotGaj);

  // Early feasibility check
  const minReq = estimateMinArea(input);
  if (ba.width * ba.height < minReq) {
    throw createError("Minimum required area exceeded for the requested configuration.");
  }

  const candidates = generateCandidates(ba, input, tier, edges);

  if (candidates.length === 0) {
    throw createError("Minimum required area exceeded for the requested configuration.");
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Set openToHall based on adjacency
  const hallIds = best.rooms.filter(r => r.type === "Hall" || r.type === "Living Room").map(r => r.id);
  for (const r of best.rooms) {
    const neighbors = best.graph[r.id] || [];
    r.openToHall = neighbors.some(nid => hallIds.includes(nid));
  }

  const attachedBaths = best.rooms.filter(r => r.type.includes("Attached Bath") || r.type === "Master Attached Bath").length;
  const sharedBaths = best.rooms.filter(r => r.type === "Common Bathroom").length;

  return {
    plot: {
      width: round(plot.width), height: round(plot.height),
      gaj: round(input.plotGaj), areaSqFt: round(plot.areaSqFt), shape: input.plotShape,
    },
    rooms: best.rooms.map(r => ({
      id: r.id, type: r.type, zone: r.zone,
      x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height),
      ventilation: r.ventilation, openToHall: r.openToHall,
    })),
    meta: {
      dwellingType: input.dwellingType,
      tier,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      connected: best.validation.connected,
      hallSegments: best.validation.hallSegments,
      deadSpaceArea: best.deadSpace,
      attachedBathrooms: attachedBaths,
      sharedBathrooms: sharedBaths,
      buildableArea: { x: ba.x, y: ba.y, width: ba.width, height: ba.height },
      ventilationWarnings: best.ventWarnings,
      score: best.score,
      layoutMode: "smart-zoning",
      planningLogic: "smart-zoning",
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   AREA ESTIMATION
   ═══════════════════════════════════════════════════════════ */

function estimateMinArea(input) {
  let area = 0;
  area += 12 * 14; // master
  area += Math.max(0, input.bedrooms - 1) * 10 * 12; // other beds
  area += 12 * 16; // living
  area += 8 * 10;  // kitchen
  area += input.bathrooms * 4 * 7; // baths
  area += 3 * 4;   // shaft
  area += 4 * 4;   // entrance
  area += 3 * 10;  // corridors
  return area * 0.55; // packing efficiency
}

export default { generateSmartLayout };
