const ROUNDING_DIGITS = 2;
const SHAPE_RATIOS = { square: 1, rectangle: 0.78, "deep-rectangle": 0.62 };
const MIN_GAJ = 60;
const MAX_GAJ = 400;

/* ── Helpers ── */

function createError(msg) { const e = new Error(msg); e.code = "NOT_POSSIBLE"; return e; }
function round(v) { const s = 10 ** ROUNDING_DIGITS; return Math.round(v * s) / s; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function makeRoom(id, type, zone, x, y, w, h, extra = {}) {
  return { id, type, zone, x: round(x), y: round(y), width: round(w), height: round(h), ...extra };
}

/* ── Input handling ── */

function normalizeInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw createError("Layout input must be a JSON object.");

  const sw = Number(raw.plotWidth), sh = Number(raw.plotHeight);
  const derivedGaj = Number.isFinite(sw) && Number.isFinite(sh) ? (sw * sh) / 9 : NaN;
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
  if (![
    "north", "south", "east", "west",
  ].includes(inp.frontDirection)) {
    throw createError("frontDirection must be north, south, east, or west.");
  }
}

function derivePlotDimensions(gaj, shape, rawW, rawH, frontDirection) {
  const dir = String(frontDirection ?? "south").toLowerCase();
  const shouldSwap = dir === "east" || dir === "west";

  if (rawW && rawH) {
    const width = shouldSwap ? rawH : rawW;
    const height = shouldSwap ? rawW : rawH;
    return { width, height, areaSqFt: rawW * rawH };
  }

  const area = gaj * 9;
  const ratio = SHAPE_RATIOS[shape];
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

function resolveFeatures(input, tier) {
  const isHouse = input.dwellingType === "house";
  return {
    includesPorch: true,
    includesParking: isHouse && tier === "large",
    includesFrontYard: isHouse && tier !== "compact",
    includesBackUtility: isHouse && tier === "large",
    includesStaircase: !isHouse,
    includesBalcony: !isHouse,
    attachedBathCount: Math.max(0, Math.min(input.bedrooms, input.bathrooms - 1)),
  };
}

/* ══════════════════════════════════════════════════════════════
   BOUNDARY MAPPING
   Maps user-selected frontDirection + boundary statuses into
   layout coordinate edges (left / right / back).
   Layout: front is always at bottom (high Y), back at top (low Y).
   ═══════════════════════════════════════════════════════════ */

function mapEdges(boundaries, frontDir) {
  if (!boundaries || typeof boundaries !== "object")
    return { left: "covered", right: "covered", back: "covered" };

  const dir = String(frontDir ?? "south").toLowerCase();
  const edgeState = {
    north: boundaries.north,
    south: boundaries.south,
    east: boundaries.east,
    west: boundaries.west,
  };

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
    left: edgeState[leftDir] === "open" ? "open" : "covered",
    right: edgeState[rightDir] === "open" ? "open" : "covered",
    back: edgeState[opp[dir]] === "open" ? "open" : "covered",
  };
}

/* ══════════════════════════════════════════════════════════════
   LAYOUT BUILDER — Boundary-aware placement
   ══════════════════════════════════════════════════════════════

   Structure (top to bottom in coordinate space):

     ┌──────────────────────────────────┐
     │       BACK UTILITY (optional)    │  Full-width strip (Indian standard)
     ├───────────────────────┬──────────┤
     │  BEDROOM BACK BAND   │          │  Bedrooms + attached baths side by side
     │  (Master │ MB │ B2 │ B3)        │
     ├──────────┬────────────┤ SERVICE  │
     │  Bed 4+  │            │ COLUMN   │  Kitchen, Common Bath, Shaft
     │  (side)  │   HALL     │ (covered │  (on covered wall)
     │  column  │  (bounded) │  side)   │
     ├──────────┴────────────┴──────────┤
     │  FRONT BAND (porch/stair/balc)   │
     ├──────────────────────────────────┤
     │  FRONT OPEN (parking/yard)       │  (houses only)
     └──────────────────────────────────┘

   Key rules:
   • Service stack on COVERED side
   • Bedrooms prefer OPEN sides (ventilation)
   • Hall bounded: prefer width ≤ 22
   • Attached bath: 5ft wide, adjacent to bedroom, shares one wall
   • Max bedrooms per edge: floor(edgeLength / 11)
   ═══════════════════════════════════════════════════════════ */

function buildLayout(plot, input, tier, features) {
  const rooms = [];
  const W = plot.width;
  const H = plot.height;
  const edges = mapEdges(input.boundaries, input.frontDirection);
  const isLarge = tier === "large";

  /* ── 1. Front open strip ── */
  let frontOpenH = 0;
  const frontAnchorY = H;
  if (features.includesParking) {
    // Reserve a full frontage band at the front edge; target 20-25 ft parking width.
    frontOpenH = clamp(H * 0.14, 7, 10);
    const minYardW = clamp(W * 0.2, 4, 10);
    let parkW = clamp(W * 0.62, 20, 25);
    parkW = Math.min(parkW, Math.max(0, W - minYardW));
    parkW = clamp(parkW, 0, W);
    const frontBandY = frontAnchorY - frontOpenH;

    rooms.push(makeRoom("parking", "Parking", "Outdoor", 0, frontBandY, parkW, frontOpenH));
    if (W - parkW > 0.1) {
      rooms.push(makeRoom("front_yard", "Front Yard", "Outdoor", parkW, frontBandY, W - parkW, frontOpenH));
    }
  } else if (features.includesFrontYard) {
    frontOpenH = clamp(H * 0.09, 5, 8);
    rooms.push(makeRoom("front_yard", "Front Yard", "Outdoor", 0, frontAnchorY - frontOpenH, W, frontOpenH));
  }

  /* ── 2. Front band ── */
  const frontBandH = clamp((H - frontOpenH) * 0.12, 5, 8);
  const frontBandY = H - frontOpenH - frontBandH;

  if (features.includesStaircase) {
    const stairW = clamp(W * 0.18, 7, 10);
    rooms.push(makeRoom("staircase", "Staircase", "Front", 0, frontBandY, stairW, frontBandH));
    const lobbyW = clamp(W * 0.28, 8, 14);
    rooms.push(makeRoom("entry_lobby", "Entry Lobby", "Front", stairW, frontBandY, lobbyW, frontBandH));
    const balcX = stairW + lobbyW;
    if (W - balcX >= 5) {
      rooms.push(makeRoom("balcony_1", "Balcony", "Outdoor", balcX, frontBandY, W - balcX, frontBandH));
    }
  } else {
    const porchW = clamp(W * 0.3, 8, 14);
    const porchX = round((W - porchW) / 2);
    rooms.push(makeRoom("porch", "Entrance Porch", "Front", porchX, frontBandY, porchW, frontBandH));
  }

  /* ── 3. Back utility strip (full-width, Indian standard) ── */
  let backH = 0;
  if (features.includesBackUtility) {
    backH = clamp(H * 0.08, 4, 6);
    rooms.push(makeRoom("back_utility", "Back Utility", "Outdoor", 0, 0, W, backH));
  }

  /* ── 4. Core area ── */
  const coreY = backH;
  const coreH = frontBandY - backH;
  if (coreH < 20 || W < 18) throw createError("Plot is too small for this layout.");

  /* ── 5. Service stack side ── */
  let serviceOnRight;
  if (edges.left === "covered" && edges.right !== "covered") serviceOnRight = false;
  else if (edges.right === "covered" && edges.left !== "covered") serviceOnRight = true;
  else serviceOnRight = true; // default

  const serviceW = clamp(W * 0.2, 8, 12);

  /* ── 6. Bedroom distribution ── */
  const numBeds = input.bedrooms;
  const numABaths = features.attachedBathCount;
  const aBathW = 5; // attached bath width

  // Back band height (flexible range 11-15, up to 16 on large plots)
  const backBandH = clamp(coreH * 0.38, 11, isLarge ? 16 : 15);
  const backBandY = coreY;

  // How many bedrooms fit in the back band?
  // Each bedroom unit = bedroom(10-16ft) + optional bath(5ft)
  const bandAvailW = W;
  const maxBedsInBandCap = Math.min(numBeds, Math.floor(bandAvailW / 11), 4);
  const provisionalBathsInBand = Math.min(numABaths, maxBedsInBandCap);
  const totalBathWidthInBand = provisionalBathsInBand * aBathW;
  const widthForBeds = bandAvailW - totalBathWidthInBand;
  const maxBedsInBand = Math.min(Math.floor(widthForBeds / 10), Math.floor(bandAvailW / 11));
  let bedsInBand = Math.min(numBeds, maxBedsInBand, 4); // cap at 4 per edge

  // If not all beds fit in band, overflow goes to side column
  let bedsInSide = numBeds - bedsInBand;

  // Try to keep hall width ≤ 22 by moving extra beds to a side column
  const HALL_MAX_W = 22;
  const sideColEstW = clamp(W * 0.25, 10, 14);
  const hallEstForCheck = bedsInSide > 0
    ? W - serviceW - sideColEstW
    : W - serviceW;

  // Only move beds if: (a) hall would be too wide, (b) adding side column actually helps
  if (hallEstForCheck > HALL_MAX_W && bedsInBand > 1) {
    // Moving ONE bed is enough to create the side column.
    // Moving more doesn't help — sideColW is fixed regardless.
    // The hall enforcement below (lines 381+) handles any remaining excess.
    bedsInBand--;
    bedsInSide++;
  }
  // Attached baths: first N go to back band beds
  const bathsInBand = Math.min(numABaths, bedsInBand);

  // Calculate back band bedroom widths
  const bandBathW = bathsInBand * aBathW;
  const bandBedsAvail = bandAvailW - bandBathW;
  const masterBonus = 0.2;
  const totalShares = (1 + masterBonus) + Math.max(0, bedsInBand - 1);
  const oneShare = bandBedsAvail / totalShares;

  const bandWidths = [];
  const masterMaxW = isLarge ? 16 : 14;
  let masterW = Math.min(round(oneShare * (1 + masterBonus)), masterMaxW);
  bandWidths.push(masterW);

  for (let i = 1; i < bedsInBand; i++) {
    bandWidths.push(round(oneShare));
  }

  // Cap bedroom widths to range [10, 14] (master up to 16)
  for (let i = 0; i < bandWidths.length; i++) {
    const maxW = i === 0 ? masterMaxW : 14;
    bandWidths[i] = clamp(bandWidths[i], 10, maxW);
  }

  // Enforce max ratio 1.5 on back band bedrooms
  for (let i = 0; i < bandWidths.length; i++) {
    const ratio = bandWidths[i] / backBandH;
    if (ratio > 1.5) bandWidths[i] = round(backBandH * 1.5);
    const ratioInv = backBandH / bandWidths[i];
    if (ratioInv > 1.5) bandWidths[i] = round(backBandH / 1.5);
  }

  // Scale to fit if total exceeds available width
  let totalBandUsed = bandWidths.reduce((s, w) => s + w, 0) + bandBathW;
  if (totalBandUsed > bandAvailW) {
    const scale = (bandAvailW - bandBathW) / bandWidths.reduce((s, w) => s + w, 0);
    for (let i = 0; i < bandWidths.length; i++) bandWidths[i] = round(bandWidths[i] * scale);
    totalBandUsed = bandWidths.reduce((s, w) => s + w, 0) + bandBathW;
  }

  // Distribute proportionally among bedrooms, capped only by ratio
  const placed = bandWidths.reduce((s, w) => s + w, 0) + bandBathW;
  let remaining = bandAvailW - placed;

  if (remaining > 0.3 && bandWidths.length > 0) {
    for (let i = 0; i < bandWidths.length && remaining > 0.1; i++) {
      const maxByRatio = backBandH * 1.5;
      const canAdd = maxByRatio - bandWidths[i];
      const add = Math.min(canAdd, remaining / (bandWidths.length - i));
      bandWidths[i] = round(bandWidths[i] + add);
      remaining -= add;
    }
  }

  // Place back band: bedrooms + attached baths left to right
  let curX = serviceOnRight ? 0 : (W - bandWidths.reduce((s,w)=>s+w,0) - bathsInBand * aBathW);
  for (let i = 0; i < bedsInBand; i++) {
    const bedId = i === 0 ? "bed_1" : `bed_${i + 1}`;
    const bedType = i === 0 ? "Master Bedroom" : `Bedroom ${i + 1}`;
    rooms.push(makeRoom(bedId, bedType, "Private", curX, backBandY, bandWidths[i], backBandH));
    curX += bandWidths[i];

    if (i < bathsInBand) {
      const abId = i === 0 ? "attached_bath_1" : `attached_bath_${i + 1}`;
      const abType = i === 0 ? "Master Attached Bath" : `Attached Bath ${i + 1}`;
      // Place bath on the external-wall side of the bedroom (right side)
      rooms.push(makeRoom(abId, abType, "Service", curX, backBandY, aBathW, backBandH));
      curX += aBathW;
    }
  }

  // After placement loop, snap last room's right edge to W
  const lastBandRoom = rooms[rooms.length - 1];  // rightmost back band room
  const rightEdge = lastBandRoom.x + lastBandRoom.width;
  if (W - rightEdge > 0.1 && W - rightEdge < 2) {
    lastBandRoom.width = round(W - lastBandRoom.x);
  }

  // After the placement loop, snap first room's left edge to 0 if service on left
  if (!serviceOnRight) {
    const firstBandRoom = rooms.find(r => round(r.y) === round(backBandY));
    if (firstBandRoom && firstBandRoom.x > 0.1 && firstBandRoom.x < 2) {
      const shift = firstBandRoom.x;
      rooms
        .filter(r => round(r.y) === round(backBandY))
        .forEach(r => { r.x = round(r.x - shift); });
      // Expand the leftmost room to absorb the gap
      firstBandRoom.width = round(firstBandRoom.width + shift);
    }
  }

  /* ── 7. Middle area: Service + Side bedrooms + Hall ── */
  const midY = backBandY + backBandH;
  const midH = frontBandY - midY;
  if (midH < 8) throw createError("Not enough vertical space for hall.");

  // Service column
  const serviceX = serviceOnRight ? W - serviceW : 0;

  // Kitchen (upper portion of service column)
  let kitchenH = clamp(midH * 0.55, 8, 14);
  let bathShaftH = midH - kitchenH;
  if (bathShaftH > 10) {
    kitchenH += (bathShaftH - 10);
    bathShaftH = 10;
  }
  rooms.push(makeRoom("kitchen", "Kitchen", "Service",
    serviceX, midY, serviceW, kitchenH, { openToHall: true }));

  // Common bath + shaft (lower portion, side by side)
  const shaftW = 4;
  const cbW = serviceW - shaftW;

  if (serviceOnRight) {
    rooms.push(makeRoom("common_bath", "Common Bathroom", "Service",
      serviceX, midY + kitchenH, cbW, bathShaftH));
    rooms.push(makeRoom("shaft", "Shaft", "Service",
      W - shaftW, midY + kitchenH, shaftW, bathShaftH));
  } else {
    rooms.push(makeRoom("shaft", "Shaft", "Service",
      0, midY + kitchenH, shaftW, bathShaftH));
    rooms.push(makeRoom("common_bath", "Common Bathroom", "Service",
      shaftW, midY + kitchenH, cbW, bathShaftH));
  }

  // Side bedroom column (overflow bedrooms on the open side, opposite service)
  let sideColW = 0;
  if (bedsInSide > 0) {
    const sideOnLeft = serviceOnRight; // side column goes opposite service
    sideColW = clamp(W * 0.25, 10, 14);
    const sideX = sideOnLeft ? 0 : W - sideColW;
    const perBedH = round(midH / bedsInSide);

    for (let i = 0; i < bedsInSide; i++) {
      const idx = bedsInBand + i;
      const bedH = (i === bedsInSide - 1) ? midH - i * perBedH : perBedH; // last fills remainder
      rooms.push(makeRoom(`bed_${idx + 1}`, `Bedroom ${idx + 1}`, "Private",
        sideX, midY + i * perBedH, sideColW, bedH));
    }
  }

  // Hall: fills remaining center of mid area
  let hallX, hallW;
  if (serviceOnRight) {
    hallX = sideColW;
    hallW = W - serviceW - sideColW;
  } else {
    hallX = serviceW;
    hallW = W - serviceW - sideColW;
  }

  // Hall bounds enforcement: if hall is too wide, expand side column to absorb excess
  if (hallW > HALL_MAX_W) {
    const excessW = hallW - HALL_MAX_W;

    if (bedsInSide > 0) {
      // Expand existing side column bedrooms (cap width to keep area < master)
      const master = rooms.find(r => r.id === "bed_1");
      const masterArea = master ? master.width * master.height : Infinity;
      const sideBeds = rooms.filter(r => r.type.includes("Bedroom") && round(r.y) >= round(midY));
      for (const sb of sideBeds) {
        const oldW = sb.width;
        const newW = sb.width + excessW;
        const maxW = masterArea / sb.height - 0.5; // keep area under master
        sb.width = round(Math.min(newW, Math.max(sb.width, maxW)));
        
        // Shift left so right edge stays anchored to plot boundary
        if (!serviceOnRight) {  // side column is on the right
          sb.x = round(W - sb.width);
        }
      }
      sideColW = sideBeds.length > 0 ? sideBeds[0].width : sideColW + excessW;
    } else {
      // Create a bedroom extension from the back band into mid area
      sideColW = excessW;
      const extSide = serviceOnRight ? "left" : "right";
      const backBandBeds = rooms.filter(r => round(r.y) === round(backBandY) && r.type.includes("Bed"));
      const extendBed = extSide === "left" ? backBandBeds[0] : backBandBeds[backBandBeds.length - 1];
      if (extendBed && excessW > 2) {
        rooms.push(makeRoom(
          extendBed.id + "_ext", extendBed.type + " Extension", "Private",
          extSide === "left" ? 0 : W - excessW,
          midY, excessW, midH
        ));
      }
    }

    // Recalculate hall position and width
    if (serviceOnRight) {
      hallX = sideColW;
      hallW = W - serviceW - sideColW;
    } else {
      hallX = serviceW;
      hallW = W - serviceW - sideColW;
    }
  }

  if (hallW >= 10 && midH >= 10) {
    rooms.push(makeRoom("hall", "Hall", "Public", hallX, midY, hallW, midH,
      { circulationWidth: round(hallW) }));
  }

  return rooms;
}

/* ── Final validation ── */

function validateRooms(rooms, pw, ph) {
  for (const r of rooms) {
    if (r.x < -0.1 || r.y < -0.1 || r.width <= 0 || r.height <= 0
        || r.x + r.width > pw + 0.5 || r.y + r.height > ph + 0.5) {
      return false;
    }
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      if (a.x < b.x + b.width - 0.1 && a.x + a.width > b.x + 0.1
          && a.y < b.y + b.height - 0.1 && a.y + a.height > b.y + 0.1) {
        return false;
      }
    }
  }
  return true;
}

/* ── Ratio / size sanity check (post-placement) ── */

function applyCorrections(rooms, W) {
  // Ensure master bedroom is largest by area
  const beds = rooms.filter(r => r.id.startsWith("bed_") && !r.id.includes("_ext"));
  const master = beds.find(r => r.id === "bed_1");
  if (master && beds.length > 1) {
    const masterArea = master.width * master.height;
    for (const bed of beds) {
      if (bed.id === "bed_1") continue;
      if (bed.width * bed.height > masterArea) {
        // Shrink this bed slightly (reduce width by small amount)
        const excess = (bed.width * bed.height - masterArea) / bed.height;
        bed.width = round(bed.width - Math.min(excess, bed.width * 0.1));
        // Re-anchor right-side beds after shrinking
        if (bed.x + bed.width < W - 1 && bed.x > W / 2) {
          bed.x = round(W - bed.width);
        }
      }
    }
  }
  return rooms;
}

/* ── Public API ── */

export function generateLayout(rawInput) {
  const input = normalizeInput(rawInput);
  validateInput(input);
  const plot = derivePlotDimensions(
    input.plotGaj,
    input.plotShape,
    input.rawW,
    input.rawH,
    input.frontDirection,
  );
  const tier = resolveTier(input.plotGaj);
  const features = resolveFeatures(input, tier);
  let rooms = buildLayout(plot, input, tier, features);
  rooms = applyCorrections(rooms, plot.width);

  if (!validateRooms(rooms, plot.width, plot.height)) {
    throw createError("Unable to generate a valid layout for the selected plot.");
  }

  return {
    plot: {
      width: round(plot.width), height: round(plot.height),
      gaj: round(input.plotGaj), areaSqFt: round(plot.areaSqFt), shape: input.plotShape,
    },
    rooms: rooms.map(r => ({
      ...r, x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height),
    })),
    meta: {
      dwellingType: input.dwellingType, tier,
      bedrooms: input.bedrooms, bathrooms: input.bathrooms,
      frontDirection: input.frontDirection,
      features, planningLogic: "boundary-aware",
    },
  };
}

export default { generateLayout };