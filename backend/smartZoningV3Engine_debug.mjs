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
  medium:  { front: 1.5 * 3.281, sides: 0.6 * 3.281, rear: 1.0 * 3.281 },
  large:   { front: 2.0 * 3.281, sides: 1.0 * 3.281, rear: 1.5 * 3.281 },
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
function snapToGrid(v, grid = 0.5) { return Math.round(v / grid) * grid; }

function createError(msg) {
  const e = new Error(msg);
  e.code = "NOT_POSSIBLE";
  return e;
}

function makeRoom(id, type, zone, x, y, w, h, extra = {}) {
  return {
    id, type, zone,
    x: snapToGrid(x), y: snapToGrid(y),
    width: snapToGrid(w), height: snapToGrid(h),
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

  const rawWidthProvided = Object.prototype.hasOwnProperty.call(raw, "plotWidth");
  const rawHeightProvided = Object.prototype.hasOwnProperty.call(raw, "plotHeight");
  const sw = Number(raw.plotWidth), sh = Number(raw.plotHeight);
  const derivedGaj = Number.isFinite(sw) && Number.isFinite(sh) ? (sw * sh) / GAJ_TO_SQFT : NaN;
  const plotGaj = Number(raw.plotGaj ?? derivedGaj);
  const plotShape = raw.plotShape ?? (
    Number.isFinite(sw) && Number.isFinite(sh) ? deriveShape(sw / sh) : "rectangle"
  );

  return {
    plotGaj, plotShape,
    rawW: sw, rawH: sh,
    rawWidthProvided,
    rawHeightProvided,
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
  if (inp.rawWidthProvided || inp.rawHeightProvided) {
    if (!inp.rawWidthProvided || !inp.rawHeightProvided) {
      throw createError("plotWidth and plotHeight must both be provided together.");
    }
    if (!Number.isFinite(inp.rawW) || !Number.isFinite(inp.rawH) || inp.rawW <= 0 || inp.rawH <= 0) {
      throw createError("plotWidth and plotHeight must be positive numbers.");
    }
  }
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

function createZones(ba, serviceSide, ratios, input = null) {
  const pct = { ...ZONE_DEFAULTS, ...ratios };

  const depthSum = pct.private + pct.semiPrivate + pct.public;
  const normP = pct.private / depthSum;
  const normSP = pct.semiPrivate / depthSum;

  const rawPrivateH = ba.height * normP;
  // Cap the private zone height to a maximum of 18ft to prevent tube bedrooms
  const privateH = snapToGrid(Math.min(rawPrivateH, 18));
  
  // Transfer any unused height from the private zone into the semi-private zone
  const semiPrivateH = snapToGrid((ba.height * normSP) + (rawPrivateH - privateH));
  const publicH = round(ba.height - privateH - semiPrivateH);

  const rawServiceW = ba.width * clamp(pct.serviceWidth, 0.12, 0.30);
  let serviceW = snapToGrid(Math.max(8, rawServiceW));
  // serviceX must be grid-aligned (makeRoom uses snapToGrid on x)
  // For right-side: snap serviceX DOWN to grid so the zone doesn't shrink below 8ft
  let serviceX;
  if (serviceSide === "right") {
    serviceX = Math.floor((ba.x + ba.width - serviceW) / 0.5) * 0.5;
    serviceW = round(ba.x + ba.width - serviceX);
  } else {
    serviceX = ba.x;
  }

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
  const kitchenW = snapToGrid(clamp(sz.w, 8, 10));
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

function buildMandatoryLivingFurnitureSet(livingRoom) {
  if (!livingRoom) return null;

  const roomW = snapToGrid(livingRoom.width);
  const roomH = snapToGrid(livingRoom.height);
  if (roomW <= 0 || roomH <= 0) return null;

  const baseFootprintW = snapToGrid(16);
  const baseFootprintH = snapToGrid(11);

  const baseItems = [
    { type: "three-seater-sofa", w: snapToGrid(7), h: snapToGrid(3), x: snapToGrid(4.5), y: snapToGrid(0) },
    { type: "armchair",          w: snapToGrid(3), h: snapToGrid(3), x: snapToGrid(2.5), y: snapToGrid(5.5) },
    { type: "coffee-table",      w: snapToGrid(4), h: snapToGrid(2), x: snapToGrid(6),   y: snapToGrid(6) },
    { type: "armchair",          w: snapToGrid(3), h: snapToGrid(3), x: snapToGrid(10.5), y: snapToGrid(5.5) },
  ];

  const rotateClockwise = (items, width) => items.map((it) => {
    const nx = snapToGrid(it.y);
    const ny = snapToGrid(width - (it.x + it.w));
    return {
      type: it.type,
      w: snapToGrid(it.h),
      h: snapToGrid(it.w),
      x: nx,
      y: ny,
    };
  });

  const scaleItems = (items, scale) => items.map((it) => ({
    type: it.type,
    w: snapToGrid(it.w * scale),
    h: snapToGrid(it.h * scale),
    x: snapToGrid(it.x * scale),
    y: snapToGrid(it.y * scale),
  }));

  const tryFit = (items, baseW, baseH) => {
    const maxScaleByRoom = snapToGrid(Math.min(roomW / baseW, roomH / baseH), 0.01);
    if (maxScaleByRoom <= 0) return null;

    // Allow compact-housing downscale while preserving furniture ratios.
    const minScale = snapToGrid(0.75, 0.01);
    const fitScale = maxScaleByRoom >= 1
      ? snapToGrid(1, 0.01)
      : snapToGrid(maxScaleByRoom, 0.01);

    if (fitScale < minScale) return null;

    const scaledW = snapToGrid(baseW * fitScale);
    const scaledH = snapToGrid(baseH * fitScale);
    const offX = snapToGrid((roomW - scaledW) / 2);
    const offY = snapToGrid((roomH - scaledH) / 2);
    const scaledItems = scaleItems(items, fitScale);

    return scaledItems.map((it) => ({
      type: it.type,
      x: snapToGrid(livingRoom.x + offX + it.x),
      y: snapToGrid(livingRoom.y + offY + it.y),
      width: snapToGrid(it.w),
      height: snapToGrid(it.h),
    }));
  };

  const upright = tryFit(baseItems, baseFootprintW, baseFootprintH);
  if (upright) return upright;

  const rotatedBase = rotateClockwise(baseItems, baseFootprintW);
  return tryFit(rotatedBase, baseFootprintH, baseFootprintW);
}

function buildMandatoryMasterBedFurnitureSet(masterBed) {
  if (!masterBed) return null;
  const W = snapToGrid(masterBed.width);
  const H = snapToGrid(masterBed.height);
  
  const bedTotalW = 9;
  const bedH = 6.5;
  const wardDepth = 2;
  const wardLen = 6;
  const clearance = snapToGrid(2.5);

  if (H >= snapToGrid(bedH + clearance + wardDepth) && W >= bedTotalW) {
    const bX = snapToGrid((W - 6) / 2);
    return [
      { type: "double-bed", w: 6, h: bedH, x: snapToGrid(masterBed.x + bX), y: snapToGrid(masterBed.y) },
      { type: "nightstand", w: 1.5, h: 1.5, x: snapToGrid(masterBed.x + bX - 1.5), y: snapToGrid(masterBed.y) },
      { type: "nightstand", w: 1.5, h: 1.5, x: snapToGrid(masterBed.x + bX + 6), y: snapToGrid(masterBed.y) },
      { type: "wardrobe", w: wardLen, h: wardDepth, x: snapToGrid(masterBed.x + (W - wardLen)/2), y: snapToGrid(masterBed.y + H - wardDepth) }
    ];
  }

  if (W >= snapToGrid(bedH + clearance + wardDepth) && H >= bedTotalW) {
    const bY = snapToGrid((H - 6) / 2);
    return [
      { type: "double-bed", w: bedH, h: 6, x: snapToGrid(masterBed.x), y: snapToGrid(masterBed.y + bY) },
      { type: "nightstand", w: 1.5, h: 1.5, x: snapToGrid(masterBed.x), y: snapToGrid(masterBed.y + bY - 1.5) },
      { type: "nightstand", w: 1.5, h: 1.5, x: snapToGrid(masterBed.x), y: snapToGrid(masterBed.y + bY + 6) },
      { type: "wardrobe", w: wardDepth, h: wardLen, x: snapToGrid(masterBed.x + W - wardDepth), y: snapToGrid(masterBed.y + (H - wardLen)/2) }
    ];
  }
  
  return null;
}

/* ═══════════════════════════════════════════════════════════
   STEP 2a — HOUSE LAYOUT
   ═══════════════════════════════════════════════════════════ */

function buildHouseLayout(ba, zones, input, tier, serviceSide, entranceAlign) {
  const dwellingType = input?.dwellingType || "house";
  if (dwellingType !== "house") {
      throw createError("buildHouseLayout is strictly for house layouts.");
  }

  const rooms = [];
  const W = ba.width;
  const plotAspect = snapToGrid(ba.width / ba.height, 0.01);
  const isSquare = plotAspect >= 0.85 && plotAspect <= 1.15;
  const isLarge = tier === "large";
  const numBeds = input.bedrooms;
  const numBaths = input.bathrooms;
  const attachedBathCount = Math.max(0, Math.min(numBeds, numBaths - 1));
  let squareLivingFrame = null;
  let squareHasPublicHall = false;

  /* ─── PUBLIC ZONE: entrance + living as full-height block ─── */
  const pubZ = zones.public;
  const nonServiceW = snapToGrid(W - zones.service.w);
  const nonServiceX = serviceSide === "right" ? pubZ.x : snapToGrid(pubZ.x + zones.service.w);
  const livingX = nonServiceX;

  // Compute living/entrance depths so they always fit inside the public band.
  const rawLivingH = snapToGrid(pubZ.h * 0.70);
  const minPorchH = snapToGrid(pubZ.h >= 14 ? 4 : 3);
  const maxLivingH = snapToGrid(Math.max(8, pubZ.h - minPorchH));
  const minLivingH = snapToGrid(Math.min(12, Math.max(9, maxLivingH)));
  let livingH = snapToGrid(clamp(rawLivingH, minLivingH, maxLivingH));
  let porchH = snapToGrid(Math.max(minPorchH, snapToGrid(pubZ.h - livingH)));

  const publicOverflow = snapToGrid(snapToGrid(livingH + porchH) - pubZ.h);
  if (publicOverflow > 0) {
    const reducibleLiving = snapToGrid(Math.max(0, livingH - 9));
    const reduceBy = snapToGrid(Math.min(publicOverflow, reducibleLiving));
    livingH = snapToGrid(livingH - reduceBy);
    porchH = snapToGrid(Math.max(3, snapToGrid(pubZ.h - livingH)));
  }
  const porchW = clamp(W * 0.30, 6, 14);
  const porchX = entranceAlign === "centered"
    ? snapToGrid(nonServiceX + (nonServiceW - porchW) / 2)
    : snapToGrid(nonServiceX + nonServiceW * 0.05);
  const porchY = snapToGrid(pubZ.y + livingH);

  rooms.push(makeRoom("entrance", "Entrance", "Public", porchX, porchY, porchW, porchH));

  // Calculate maximum allowed width based on a 1:1.8 ratio
  const finalLivingH = snapToGrid(livingH);
  const maxLivingW = snapToGrid(finalLivingH * 1.8);

  if (isSquare) {
    const minSquareLivingW = snapToGrid(Math.max(12, snapToGrid(nonServiceW * 0.5)));
    const maxSquareLivingW = snapToGrid(Math.max(minSquareLivingW, snapToGrid(nonServiceW * 0.6)));
    const targetSquareLivingW = snapToGrid(nonServiceW * 0.55);
    const livingW = snapToGrid(clamp(targetSquareLivingW, minSquareLivingW, maxSquareLivingW));
    const livingSquareX = serviceSide === "right"
      ? snapToGrid(nonServiceX + (nonServiceW - livingW))
      : nonServiceX;

    rooms.push(makeRoom("living", "Living Room", "Public",
      livingSquareX, pubZ.y, livingW, finalLivingH, { openToHall: true }));

    const hallStripW = snapToGrid(nonServiceW - livingW);
    if (hallStripW >= 6) {
      const hallX = serviceSide === "right"
        ? nonServiceX
        : snapToGrid(livingSquareX + livingW);
      rooms.push(makeRoom("hall", "Hall", "Semi-private",
        hallX, pubZ.y, hallStripW, finalLivingH,
        { openToHall: true, circulationWidth: snapToGrid(hallStripW) }));
      squareHasPublicHall = true;
    }

    squareLivingFrame = {
      x: snapToGrid(livingSquareX),
      width: snapToGrid(livingW),
    };
  }

  // If the available nonServiceW is larger than our max allowed width, we split it.
  if (!isSquare && nonServiceW > maxLivingW) {
      // Place Living Room capped at max width
      rooms.push(makeRoom("living", "Living Room", "Public",
        nonServiceX, pubZ.y, maxLivingW, finalLivingH, { openToHall: true }));

      // Use the remaining width on the same band to create an expanded Entrance/Foyer
      // to keep the layout rectangular and connected.
      const leftoverW = snapToGrid(nonServiceW - maxLivingW);
      const leftoverX = snapToGrid(nonServiceX + maxLivingW);

      // Assign the leftover width area as a "Front Yard" (type: "Outdoor").
      // Ensure its coordinates perfectly align next to the capped Living Room so the entire nonServiceW is filled edge-to-edge.
      rooms.push(makeRoom("front_yard", "Front Yard", "Outdoor",
        leftoverX, pubZ.y, leftoverW, finalLivingH));
  } else if (!isSquare) {
      // Normal placement if it doesn't violate aspect ratio
      const fallbackH = livingH >= 12 ? finalLivingH : snapToGrid(pubZ.h - porchH);
      rooms.push(makeRoom("living", "Living Room", "Public",
        livingX, pubZ.y, nonServiceW, fallbackH, { openToHall: true }));
  }

  const livingRoom = rooms.find((r) => r.id === "living");
  const livingFurniture = buildMandatoryLivingFurnitureSet(livingRoom);
  if (!livingFurniture) {
    throw createError("Minimum required area exceeded for the requested configuration.");
  }
  livingRoom.furniture = livingFurniture;

  if (isLarge) {
    const parkW = clamp(W * 0.4, 10, 18);
    const parkX = porchX + porchW;
    const avail = ba.x + W - parkX;
    if (avail >= 8 && !rooms.some(r => r.id === "parking")) {
      rooms.push(makeRoom("parking", "Parking", "Outdoor",
        parkX, porchY, Math.min(parkW, avail), porchH));
    }
  } else if (tier === "standard") {
    const yardW = round(W - porchW - 1);
    if (yardW > 4 && !rooms.some(r => r.id === "front_yard")) {
      const yardX = porchX + porchW;
      const avail = ba.x + W - yardX;
      if (avail > 4) {
        rooms.push(makeRoom("front_yard", "Front Yard", "Outdoor",
          yardX, porchY, Math.min(yardW, avail), porchH));
      }
    }
  }

  /* ─── PRIVATE ZONE: bedrooms + attached baths ─── */
  const pvZ = zones.private;
  const spZ = zones.semiPrivate;
  const aBathDepth = 5;  // standard attached bath depth (stacked vertically)

  // Bedrooms always start at the rear wall for ventilation
  let bedZoneY = pvZ.y;
  let bedZoneH = pvZ.h;

  const maxBedsInBand = Math.min(numBeds, Math.floor(pvZ.w / 10), 4);
  let bedsInBand = maxBedsInBand;
  let bedsInSide = numBeds - bedsInBand;

  // Pre-compute side column width so main band accounts for it
  const sideOnLeft = serviceSide === "right";
  const sideColW_pre = bedsInSide > 0 ? clamp(W * 0.25, 10, 14) : 0;

  // Effective main band bounds (exclude side column region)
  const bandX = sideOnLeft ? snapToGrid(pvZ.x + sideColW_pre) : pvZ.x;
  const bandW = snapToGrid(pvZ.w - sideColW_pre);

  // ── Pre-placement width check with circuit breaker ──
  // Baths are now stacked vertically, so they do NOT consume horizontal width
  let widthValid = false;
  while (!widthValid) {
    const effSideColW = (numBeds - bedsInBand) > 0 ? clamp(W * 0.25, 10, 14) : 0;
    const effBandW = snapToGrid(pvZ.w - effSideColW);
    const checkPerBedW = effBandW / bedsInBand;

    const masterMinW = (bedsInBand === numBeds) ? 12 : 10;
    const absoluteMinW = (input && input.plotGaj < 300) ? 9 : 10;
    const absoluteMasterMinW = (input && input.plotGaj < 300) ? 10 : masterMinW;

    if (checkPerBedW < absoluteMinW || (bedsInBand >= numBeds && checkPerBedW < absoluteMasterMinW)) {
      if (bedsInBand <= 1) {
        throw createError("Minimum required area exceeded for the requested configuration.");
      }
      bedsInBand--;
      bedsInSide = numBeds - bedsInBand;
    } else {
      widthValid = true;
    }
  }

  // Recompute side column and band bounds after width check may have changed bedsInSide
  const sideColW_final = bedsInSide > 0 ? clamp(W * 0.25, 10, 14) : 0;
  const bandXFinal = sideOnLeft ? snapToGrid(pvZ.x + sideColW_final) : pvZ.x;
  const bandWFinal = snapToGrid(pvZ.w - sideColW_final);

  const bandBathCount = Math.min(attachedBathCount, bedsInBand);
  // No horizontal bath width to subtract — baths are stacked vertically
  const perBedW = snapToGrid(bandWFinal / bedsInBand);

  let curX = bandXFinal;
  const bandRight = snapToGrid(bandXFinal + bandWFinal); // right edge of main band
  for (let i = 0; i < bedsInBand; i++) {
    const isMaster = i === 0;
    const bedId = isMaster ? "bed_1" : `bed_${i + 1}`;
    const bedType = isMaster ? "Master Bedroom" : `Bedroom ${i + 1}`;

    // Determine column width for this bedroom
    let bedW;
    if (i === bedsInBand - 1) {
      // Last bed: fill remaining width to band edge
      bedW = snapToGrid(bandRight - curX);
    } else {
      bedW = isMaster ? clamp(snapToGrid(perBedW * 1.15), 12, 16) : clamp(perBedW, 10, 14);
    }

    bedW = Math.max(10, bedW);
    // Cap to never exceed remaining band space
    const maxAvailForBed = snapToGrid(bandRight - curX);
    bedW = Math.min(bedW, maxAvailForBed);

    // FIX 3: Stack attached bath vertically inside the bedroom column
    let currentBedY = bedZoneY;
    let currentBedH = bedZoneH;

    if (i < bandBathCount) {
      // Place attached bath at the top (rear) of the column, spanning full bedW
      const aBathH = snapToGrid(Math.min(aBathDepth, bedZoneH * 0.35));
      const abId = isMaster ? "attached_bath_1" : `attached_bath_${i + 1}`;
      const abType = isMaster ? "Master Attached Bath" : `Attached Bath ${i + 1}`;
      rooms.push(makeRoom(abId, abType, "Service",
        curX, currentBedY, bedW, aBathH));
      // Push bedroom start down to avoid overlap
      currentBedY = snapToGrid(currentBedY + aBathH);
      currentBedH = snapToGrid(currentBedH - aBathH);
    }

    // Place bedroom using remaining column height
    rooms.push(makeRoom(bedId, bedType, "Private", curX, currentBedY, bedW, currentBedH));
    curX += bedW;
  }

  // ── FIX 3: Side column overflow bedrooms span private + semi-private ──
  if (bedsInSide > 0) {
    const sideColW = sideColW_final;
    const sideX = sideOnLeft ? ba.x : snapToGrid(ba.x + W - sideColW);
    const sideH = pvZ.h + spZ.h;   // spans both private and semi-private zones
    const sideY = pvZ.y;            // starts at top of private zone
    const perSideBedH = snapToGrid(sideH / bedsInSide);

    // Enforce max aspect ratio 1:1.6
    const maxBedH = snapToGrid(sideColW * 1.6);
    const actualBedH = perSideBedH > maxBedH ? maxBedH : perSideBedH;

    for (let i = 0; i < bedsInSide; i++) {
      const idx = bedsInBand + i;
      const bedH = (i === bedsInSide - 1 && actualBedH === perSideBedH) ? snapToGrid(sideH - i * actualBedH) : actualBedH;
      rooms.push(makeRoom(`bed_${idx + 1}`, `Bedroom ${idx + 1}`, "Private",
        sideX, snapToGrid(sideY + i * actualBedH), sideColW, bedH));
    }
    
    // Fill the void if we capped the height
    if (perSideBedH > maxBedH) {
        const usedH = snapToGrid(bedsInSide * actualBedH);
        const remainH = snapToGrid(sideH - usedH);
        if (remainH > 0) {
            const wantsStore = input.preferences && 
                (input.preferences.store_room === "requested" || input.preferences.store_room === "required" || input.preferences.utility === "combined");
            if (wantsStore) {
                rooms.push(makeRoom("store_room", "Store Room", "Semi-private",
                  sideX, snapToGrid(sideY + usedH), sideColW, remainH));
            }
        }
    }
  }

  /* ─── SEMI-PRIVATE ZONE: [side column] + dining + hall ─── */
  const spNonServiceW = nonServiceW;
  const spX = serviceSide === "right" ? spZ.x : snapToGrid(spZ.x + zones.service.w);

  // Reduce available width by side column when active
  const spAvailW = snapToGrid(spNonServiceW - sideColW_final);
  if (isSquare && squareLivingFrame) {
    const spAvailX = (bedsInSide > 0 && serviceSide === "right")
      ? snapToGrid(spX + sideColW_final)
      : spX;
    const maxDiningX = snapToGrid(spAvailX + spAvailW - 8);
    const diningX = snapToGrid(clamp(squareLivingFrame.x, spAvailX, maxDiningX));
    const diningW = snapToGrid(Math.min(squareLivingFrame.width, snapToGrid(spAvailX + spAvailW - diningX)));
    const diningH = spZ.h;

    if (diningW >= 8) {
      rooms.push(makeRoom("dining", "Dining", "Semi-private",
        diningX, spZ.y, diningW, diningH, { openToHall: true }));
    }

    if (!squareHasPublicHall) {
      const hallActualW = snapToGrid(spAvailW - diningW);
      if (hallActualW >= 5) {
        const hallX = snapToGrid(diningX + diningW);
        rooms.push(makeRoom("hall", "Hall", "Semi-private",
          hallX, spZ.y, hallActualW, diningH,
          { openToHall: true, circulationWidth: snapToGrid(hallActualW) }));
      }
    }
  } else {
    const diningW = clamp(spAvailW * 0.5, 8, 14);
    const diningH = spZ.h; // fill full semi-private height
    // Offset dining X past the side column if it's on the left (serviceRight → sideOnLeft)
    const diningX = (bedsInSide > 0 && serviceSide === "right")
      ? snapToGrid(spX + sideColW_final)
      : spX;
    rooms.push(makeRoom("dining", "Dining", "Semi-private",
      diningX, spZ.y, diningW, diningH, { openToHall: true }));

    const hallActualW = snapToGrid(spAvailW - diningW);
    if (hallActualW >= 5) {
      rooms.push(makeRoom("hall", "Hall", "Semi-private",
        snapToGrid(diningX + diningW), spZ.y, hallActualW, diningH,
        { openToHall: true, circulationWidth: snapToGrid(hallActualW) }));
    }
  }

  /* ─── SERVICE CORE ─── */
  const serviceRooms = placeServiceCore(zones, numBaths, attachedBathCount);
  rooms.push(...serviceRooms);

  const masterBed = rooms.find((r) => r.id === "bed_1");
  if (masterBed) {
      const masterFurn = buildMandatoryMasterBedFurnitureSet(masterBed);
      if (!masterFurn) {
          throw createError("Master Bedroom furniture cannot fit legally with clearance.");
      }
      masterBed.furniture = masterFurn;
  }

  // ── FIX 4: Space redistribution ──
  return redistributeSpace(rooms, ba, input.preferences || {});
}

/* ═══════════════════════════════════════════════════════════
   FIX 4 — SPACE REDISTRIBUTION (Post-Placement)
   ═══════════════════════════════════════════════════════════ */

function redistributeSpace(rooms, ba, preferences) {
  const totalArea = ba.width * ba.height;
  const usedArea = rooms.reduce((s, r) => s + r.width * r.height, 0);
  const deadSpaceRatio = (totalArea - usedArea) / totalArea;

  // Step 1: Keep dead space as a soft quality signal.
  // Do not hard-reject here; later scoring already penalizes poor compactness.

  // If dead space is negligible, skip expansion
  if (deadSpaceRatio <= 0.01) return rooms;

  // Step 3: Preference multipliers
  const prefMultiplier = (roomType) => {
    const key = roomType.toLowerCase().replace(/\s+/g, "_");
    const pref = preferences[key] || preferences[roomType] || "standard";
    if (pref === "compact") return 1.0;
    if (pref === "large") return 1.5;
    return 1.25; // "standard" default
  };

  let remainingSpace = totalArea - usedArea;

  const overlapY = (a, b) => {
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(snapToGrid(a.y + a.height), snapToGrid(b.y + b.height));
    return snapToGrid(bottom - top) > 0.5;
  };

  const overlapX = (a, b) => {
    const left = Math.max(a.x, b.x);
    const right = Math.min(snapToGrid(a.x + a.width), snapToGrid(b.x + b.width));
    return snapToGrid(right - left) > 0.5;
  };

  const growIntoVoid = (room, axis, direction, requestedDelta) => {
    let delta = snapToGrid(Math.max(0, requestedDelta));
    if (delta <= 0) return 0;

    if (axis === "width" && direction === "right") {
      const edge = snapToGrid(room.x + room.width);
      let limit = snapToGrid(ba.x + ba.width);
      for (const other of rooms) {
        if (other.id === room.id || !overlapY(room, other)) continue;
        if (other.x >= edge - 0.5) limit = Math.min(limit, other.x);
      }
      const gap = snapToGrid(limit - edge);
      delta = snapToGrid(Math.min(delta, gap));
      if (delta > 0) room.width = snapToGrid(room.width + delta);
      return delta;
    }

    if (axis === "width" && direction === "left") {
      const edge = room.x;
      let limit = ba.x;
      for (const other of rooms) {
        if (other.id === room.id || !overlapY(room, other)) continue;
        const otherEdge = snapToGrid(other.x + other.width);
        if (otherEdge <= edge + 0.5) limit = Math.max(limit, otherEdge);
      }
      const gap = snapToGrid(edge - limit);
      delta = snapToGrid(Math.min(delta, gap));
      if (delta > 0) {
        room.x = snapToGrid(room.x - delta);
        room.width = snapToGrid(room.width + delta);
      }
      return delta;
    }

    if (axis === "height" && direction === "bottom") {
      const edge = snapToGrid(room.y + room.height);
      let limit = snapToGrid(ba.y + ba.height);
      for (const other of rooms) {
        if (other.id === room.id || !overlapX(room, other)) continue;
        if (other.y >= edge - 0.5) limit = Math.min(limit, other.y);
      }
      const gap = snapToGrid(limit - edge);
      delta = snapToGrid(Math.min(delta, gap));
      if (delta > 0) room.height = snapToGrid(room.height + delta);
      return delta;
    }

    if (axis === "height" && direction === "top") {
      const edge = room.y;
      let limit = ba.y;
      for (const other of rooms) {
        if (other.id === room.id || !overlapX(room, other)) continue;
        const otherEdge = snapToGrid(other.y + other.height);
        if (otherEdge <= edge + 0.5) limit = Math.max(limit, otherEdge);
      }
      const gap = snapToGrid(edge - limit);
      delta = snapToGrid(Math.min(delta, gap));
      if (delta > 0) {
        room.y = snapToGrid(room.y - delta);
        room.height = snapToGrid(room.height + delta);
      }
      return delta;
    }

    return 0;
  };

  // Dynamic area redistribution for house private zone: prioritize master, then other bedrooms.
  const privateBeds = rooms
    .filter((r) => r.type === "Master Bedroom" || (r.type.includes("Bedroom") && !r.type.includes("Bath")))
    .sort((a, b) => {
      if (a.type === "Master Bedroom" && b.type !== "Master Bedroom") return -1;
      if (b.type === "Master Bedroom" && a.type !== "Master Bedroom") return 1;
      return a.id.localeCompare(b.id);
    });

  for (const bed of privateBeds) {
    if (remainingSpace <= 0.5) break;

    const ratioCap = snapToGrid(1.8, 0.1);

    const maxGrowW = snapToGrid(Math.max(0, snapToGrid(bed.height * ratioCap) - bed.width));
    if (maxGrowW > 0) {
      const budgetW = snapToGrid(remainingSpace / Math.max(0.5, bed.height));
      let askW = snapToGrid(Math.min(maxGrowW, budgetW));
      const grownRight = growIntoVoid(bed, "width", "right", askW);
      if (grownRight > 0) {
        remainingSpace = snapToGrid(Math.max(0, remainingSpace - grownRight * bed.height));
        askW = snapToGrid(Math.max(0, askW - grownRight));
      }
      if (askW > 0 && remainingSpace > 0.5) {
        const grownLeft = growIntoVoid(bed, "width", "left", askW);
        if (grownLeft > 0) {
          remainingSpace = snapToGrid(Math.max(0, remainingSpace - grownLeft * bed.height));
        }
      }
    }

    const maxGrowH = snapToGrid(Math.max(0, snapToGrid(bed.width * ratioCap) - bed.height));
    if (maxGrowH > 0 && remainingSpace > 0.5) {
      const budgetH = snapToGrid(remainingSpace / Math.max(0.5, bed.width));
      let askH = snapToGrid(Math.min(maxGrowH, budgetH));
      const grownBottom = growIntoVoid(bed, "height", "bottom", askH);
      if (grownBottom > 0) {
        remainingSpace = snapToGrid(Math.max(0, remainingSpace - grownBottom * bed.width));
        askH = snapToGrid(Math.max(0, askH - grownBottom));
      }
      if (askH > 0 && remainingSpace > 0.5) {
        const grownTop = growIntoVoid(bed, "height", "top", askH);
        if (grownTop > 0) {
          remainingSpace = snapToGrid(Math.max(0, remainingSpace - grownTop * bed.width));
        }
      }
    }
  }

  // Any leftover from ratio-capped bedroom redistribution gets absorbed by Hall as integrated storage/puja.
  const hallRoom = rooms.find((r) => r.type === "Hall");
  if (hallRoom && remainingSpace > 0.5) {
    let absorbed = 0;
    const absorbPlan = [
      ["width", "right"],
      ["width", "left"],
      ["height", "bottom"],
      ["height", "top"],
    ];

    for (const [axis, direction] of absorbPlan) {
      if (remainingSpace <= 0.5) break;
      const baseDim = axis === "width" ? hallRoom.height : hallRoom.width;
      const ask = snapToGrid(remainingSpace / Math.max(0.5, baseDim));
      const grown = growIntoVoid(hallRoom, axis, direction, ask);
      if (grown > 0) {
        const gain = snapToGrid(grown * baseDim);
        absorbed = snapToGrid(absorbed + gain);
        remainingSpace = snapToGrid(Math.max(0, remainingSpace - gain));
      }
    }

    if (absorbed > 0) {
      hallRoom.integratedUse = "storage-puja";
    }
  }

  // Step 2: Safe expansion in priority order
  const expansionPlan = [
    { match: (r) => r.type === "Master Bedroom",                      axis: "width",  maxRatio: 1.6 },
    { match: (r) => r.type.includes("Bedroom") && r.type !== "Master Bedroom", axis: "width",  maxRatio: 1.8 },
    { match: (r) => r.type === "Living Room",                          axis: "height", maxRatio: null },
    { match: (r) => r.type === "Kitchen",                              axis: "height", maxRatio: null },
    { match: (r) => r.type === "Dining",                               axis: "width",  maxRatio: null },
    { match: (r) => r.type === "Hall",                                 axis: "width",  maxRatio: null },
  ];

  for (const plan of expansionPlan) {
    if (remainingSpace <= 0.5) break;

    const targets = rooms.filter(plan.match);
    for (const room of targets) {
      if (remainingSpace <= 0.5) break;

      const mult = prefMultiplier(room.type);
      if (mult <= 1.0) continue; // compact → skip

      const currentDim = plan.axis === "width" ? room.width : room.height;
      const otherDim   = plan.axis === "width" ? room.height : room.width;
      const targetDim  = snapToGrid(currentDim * mult);

      // Enforce aspect ratio cap if specified
      let maxDim = targetDim;
      if (plan.maxRatio) {
        maxDim = Math.min(targetDim, snapToGrid(otherDim * plan.maxRatio));
      }

      let delta = snapToGrid(Math.max(0, maxDim - currentDim));
      if (delta <= 0) continue;

      // Cap delta so shifting adjacent rooms doesn't push them outside ba
      if (plan.axis === "width") {
        // Find the maximum safe delta: rooms to the right must not exceed ba boundary
        const roomRight = room.x + room.width;
        const rightRooms = rooms.filter(r => r.id !== room.id && r.x >= roomRight - 0.5);
        for (const rr of rightRooms) {
          const rrRight = rr.x + rr.width + delta;
          if (rrRight > ba.x + ba.width) {
            delta = snapToGrid(Math.max(0, ba.x + ba.width - (rr.x + rr.width)));
          }
        }
      } else {
        // height expansion: cap by rooms below
        const roomBottom = room.y + room.height;
        const belowRooms = rooms.filter(r => r.id !== room.id && r.y >= roomBottom - 0.5);
        for (const br of belowRooms) {
          const brBottom = br.y + br.height + delta;
          if (brBottom > ba.y + ba.height) {
            delta = snapToGrid(Math.max(0, ba.y + ba.height - (br.y + br.height)));
          }
        }
      }

      if (delta <= 0) continue;

      // Apply expansion
      if (plan.axis === "width") {
        room.width = snapToGrid(room.width + delta);
        // Shift rooms to the right
        const roomRight = room.x + room.width - delta; // original right edge
        for (const r of rooms) {
          if (r.id !== room.id && r.x >= roomRight - 0.5) {
            r.x = snapToGrid(r.x + delta);
          }
        }
      } else {
        room.height = snapToGrid(room.height + delta);
        // Shift rooms below
        const roomBottom = room.y + room.height - delta; // original bottom edge
        for (const r of rooms) {
          if (r.id !== room.id && r.y >= roomBottom - 0.5) {
            r.y = snapToGrid(r.y + delta);
          }
        }
      }

      remainingSpace -= delta * otherDim;
    }
  }

  // Fix 3.1: Eliminate internal voids in horizontal bands
  const yBands = new Set(rooms.map(r => r.y));
  for (const y of yBands) {
      const bandRooms = rooms.filter(r => r.y === y).sort((a,b) => a.x - b.x);
      for (let i = 0; i < bandRooms.length - 1; i++) {
          const r1 = bandRooms[i];
          const r2 = bandRooms[i+1];
          const end1 = snapToGrid(r1.x + r1.width);
          const start2 = snapToGrid(r2.x);
          if (start2 > end1) {
              const gap = snapToGrid(start2 - end1);
              const maxExpand = snapToGrid((r1.height * 2.0) - r1.width);
              if (maxExpand > 0) {
                  r1.width = snapToGrid(r1.width + Math.min(gap, maxExpand));
              }
          }
      }
  }

  // Fix 3.1: Eliminate internal voids in vertical bands
  const xBands = new Set(rooms.map(r => r.x));
  for (const x of xBands) {
      const colRooms = rooms.filter(r => r.x === x).sort((a,b) => a.y - b.y);
      for (let i = 0; i < colRooms.length - 1; i++) {
          const r1 = colRooms[i];
          const r2 = colRooms[i+1];
          const end1 = snapToGrid(r1.y + r1.height);
          const start2 = snapToGrid(r2.y);
          if (start2 > end1) {
              const gap = snapToGrid(start2 - end1);
              const maxExpand = snapToGrid((r1.width * 2.0) - r1.height);
              if (maxExpand > 0) {
                  r1.height = snapToGrid(r1.height + Math.min(gap, maxExpand));
              }
          }
      }
  }

  // Fix 3.2: Final boundary flush: force edge rooms to bounds if unblocked
  for (const r of rooms) {
    if (r.type === "Outdoor" || r.type === "Front Yard" || r.type === "Parking" || r.type === "Balcony") continue;
    
    // Right boundary gap
    const rightGap = snapToGrid(snapToGrid(ba.x + ba.width) - snapToGrid(r.x + r.width));
    if (rightGap > 0) {
      const isBlockedRight = rooms.some(other =>
        other.id !== r.id &&
        other.x >= snapToGrid(r.x + r.width) &&
        r.y < snapToGrid(other.y + other.height) &&
        snapToGrid(r.y + r.height) > other.y
      );
      if (!isBlockedRight) {
        const potentialW = snapToGrid(r.width + rightGap);
        if (potentialW / Math.max(0.1, r.height) <= 2.0) {
           r.width = potentialW;
        } else {
           r.width = snapToGrid(r.height * 2.0);
        }
      }
    }

    // Left boundary gap
    const leftGap = snapToGrid(r.x - ba.x);
    if (leftGap > 0) {
      const isBlockedLeft = rooms.some(other =>
        other.id !== r.id &&
        snapToGrid(other.x + other.width) <= r.x &&
        r.y < snapToGrid(other.y + other.height) &&
        snapToGrid(r.y + r.height) > other.y
      );
      if (!isBlockedLeft) {
          const potentialW = snapToGrid(r.width + leftGap);
          if (potentialW / Math.max(0.1, r.height) <= 2.0) {
              r.x = snapToGrid(r.x - leftGap);
              r.width = potentialW;
          } else {
              const expand = snapToGrid(r.height * 2.0) - r.width;
              if (expand > 0) {
                  r.x = snapToGrid(r.x - expand);
                  r.width = snapToGrid(r.width + expand);
              }
          }
      }
    }

    // Bottom boundary gap
    const bottomGap = snapToGrid(snapToGrid(ba.y + ba.height) - snapToGrid(r.y + r.height));
    if (bottomGap > 0) {
      const isBlockedBottom = rooms.some(other =>
        other.id !== r.id &&
        other.y >= snapToGrid(r.y + r.height) &&
        r.x < snapToGrid(other.x + other.width) &&
        snapToGrid(r.x + r.width) > other.x
      );
      if (!isBlockedBottom) {
        const potentialH = snapToGrid(r.height + bottomGap);
        if (potentialH / Math.max(0.1, r.width) <= 2.0) {
            r.height = potentialH;
        } else {
            r.height = snapToGrid(r.width * 2.0);
        }
      }
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

  const entryW = snapToGrid(clamp(nonServiceW, 5, 8));
  let entryX = nonServiceX;
  let leftoverX = snapToGrid(nonServiceX + entryW);
  const leftoverW = snapToGrid(nonServiceW - entryW);
  
  if (entranceAlign === "centered") {
      entryX = snapToGrid(nonServiceX + leftoverW);
      leftoverX = nonServiceX;
  }

  rooms.push(makeRoom("entrance", "Entrance", "Public",
    entryX, entryY, entryW, entryH));

  if (leftoverW > 0) {
      rooms.push(makeRoom("front_balcony", "Balcony", "Outdoor",
        leftoverX, entryY, leftoverW, entryH));
  }

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
  const bedroomH = Math.min(round(livingY - ba.y), 16);
  const bedroomBottomY = snapToGrid(bedroomTopY + bedroomH);
  const bridgeHallH = snapToGrid(Math.max(0, livingY - bedroomBottomY));
  if (bridgeHallH >= CORRIDOR_MIN_WIDTH) {
    rooms.push(makeRoom("flat_hall", "Hall", "Semi-private",
      nonServiceX, bedroomBottomY, nonServiceW, bridgeHallH,
      { openToHall: true, circulationWidth: snapToGrid(nonServiceW) }));
  }
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
    const totalBathW = snapToGrid(Math.min(attachedBathCount, numBeds) * aBathW);
    const bedTotalW = snapToGrid(W - totalBathW);
    const perBedW = snapToGrid(bedTotalW / numBeds);
    const minFlatBedW = snapToGrid(input.plotGaj <= 200 ? 9 : 10);

    if (perBedW < minFlatBedW) {
      throw createError("Minimum required area exceeded for the requested configuration.");
    }

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
        bedW = isMaster
          ? clamp(round(perBedW * 1.1), minFlatBedW, 16)
          : clamp(perBedW, minFlatBedW, 14);
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

  const lrRoom = rooms.find((r) => r.id === "living");
  if (lrRoom) {
      const livingFurniture = buildMandatoryLivingFurnitureSet(lrRoom);
      if (!livingFurniture) throw createError("Minimum required area exceeded for Living Room.");
      lrRoom.furniture = livingFurniture;
  }
  const fmbRoom = rooms.find((r) => r.id === "bed_1");
  if (fmbRoom) {
      const fmbFurniture = buildMandatoryMasterBedFurnitureSet(fmbRoom);
      if (!fmbFurniture) {
          throw createError("Master Bedroom furniture cannot fit legally with clearance.");
      }
      fmbRoom.furniture = fmbFurniture;
  }

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

function normalizeConstraintType(roomType) {
  if (roomType === "Master Bedroom") return "Master Bedroom";
  if (roomType.startsWith("Bedroom")) return "Bedroom";
  if (roomType === "Master Attached Bath") return "Master Attached Bath";
  if (roomType.startsWith("Attached Bath")) return "Attached Bath";
  if (roomType === "flat_hall") return "Hall";
  if (roomType === "Entry Lobby") return "Entrance";
  return roomType;
}

function validateRoomConstraints(rooms, tier, dwellingType) {
  const strictMinTypes = new Set([
    "Master Bedroom",
    "Bedroom",
    "Kitchen",
    "Master Attached Bath",
    "Attached Bath",
    "Common Bathroom",
    "Shaft",
  ]);
  const tierAwareMinTypes = new Set([
    "Living Room",
    "Dining",
    "Hall",
    "Entrance",
  ]);

  let tierMinScale = 1;
  if (tier === "compact") tierMinScale = 0.75;
  else if (tier === "standard") tierMinScale = 0.85;

  if (dwellingType === "flat") {
    tierMinScale = Math.min(tierMinScale, 0.75);
  }

  for (const r of rooms) {
    const normalizedType = normalizeConstraintType(r.type);
    const min = MIN_SIZES[normalizedType];
    if (min && (strictMinTypes.has(normalizedType) || tierAwareMinTypes.has(normalizedType))) {
      const shortSide = Math.min(r.width, r.height);
      const longSide = Math.max(r.width, r.height);
      const minScale = strictMinTypes.has(normalizedType) ? 1 : tierMinScale;
      const minShort = Math.min(min[0], min[1]) * minScale;
      const minLong = Math.max(min[0], min[1]) * minScale;
      if (shortSide + 1e-6 < minShort || longSide + 1e-6 < minLong) {
        return false;
      }
    }

    const maxRatio = MAX_RATIOS[normalizedType];
    if (maxRatio) {
      const shortSide = Math.max(0.1, Math.min(r.width, r.height));
      const longSide = Math.max(r.width, r.height);
      if (longSide / shortSide > maxRatio + 1e-6) {
        return false;
      }
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

  let serviceSides = ["left", "right"];
  if (edges?.left === "covered" && edges?.right !== "covered") {
    serviceSides = ["left"];
  } else if (edges?.right === "covered" && edges?.left !== "covered") {
    serviceSides = ["right"];
  }
  const entranceAligns = ["centered", "offset-left"];

  const zoneRatios = isFlat ? [null] : [
    { private: 0.40, semiPrivate: 0.22, public: 0.25, serviceWidth: 0.20 },
    { private: 0.44, semiPrivate: 0.20, public: 0.23, serviceWidth: 0.20 },
    { private: 0.36, semiPrivate: 0.24, public: 0.27, serviceWidth: 0.20 },
  ];

  const candidates = [];

  for (const serviceSide of serviceSides) {
    for (const entranceAlign of entranceAligns) {
      for (const ratios of zoneRatios) {
        try {
          let rooms;

          if (isFlat) {
            rooms = buildFlatLayout(ba, input, serviceSide, entranceAlign);
          } else {
            const zones = createZones(ba, serviceSide, ratios, input);
            rooms = buildHouseLayout(ba, zones, input, tier, serviceSide, entranceAlign);
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
          if (!validateNoOverlap(rooms)) continue;
          if (!validateRoomConstraints(rooms, tier, input.dwellingType)) continue;

          const ventWarnings = tagVentilation(rooms, ba);
          const graph = buildAdjacencyGraph(rooms);
          const validation = validateLayout(rooms, graph, input.dwellingType);

          // Hard rejection: connectivity for core indoor program.
          // Outdoor elements (e.g., balconies/front yard) may be detached by design.
          const entrance = rooms.find(r => r.type === "Entrance" || r.id === "entrance");
          if (!entrance) continue;

          const visited = new Set([entrance.id]);
          const queue = [entrance.id];
          while (queue.length > 0) {
            const cur = queue.shift();
            for (const neighbor of (graph[cur] || [])) {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
              }
            }
          }

          const hasDisconnectedIndoor = rooms.some(r => {
            const isOutdoor = r.zone === "Outdoor" || r.type === "Balcony" || r.type === "Front Yard" || r.type === "Parking";
            return !isOutdoor && !visited.has(r.id);
          });

          if (hasDisconnectedIndoor) continue;

          // Score (soft penalties for other validation errors)
          const zones = isFlat ? {} : createZones(ba, serviceSide, ratios, input);
          const { score, deadSpace } = scoreLayout(
            rooms, zones, ba, graph, validation, ventWarnings,
            input.dwellingType, input.vastuMode
          );

          candidates.push({
            rooms, graph, validation, ventWarnings,
            score, deadSpace, serviceSide, entranceAlign,
          });
        } catch(e) { console.log('Candidate failed:', e.stack); continue; }
      }
    }
  }

  return candidates;
}

/* ═══════════════════════════════════════════════════════════
   MAIN ORCHESTRATOR
   ═══════════════════════════════════════════════════════════ */

export { generateSmartLayout }; function generateSmartLayout(rawInput) {
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
      integratedUse: r.integratedUse || null,
      furniture: Array.isArray(r.furniture)
        ? r.furniture.map((f) => ({
            type: f.type,
            x: round(snapToGrid(f.x)),
            y: round(snapToGrid(f.y)),
            width: round(snapToGrid(f.width)),
            height: round(snapToGrid(f.height)),
          }))
        : [],
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
