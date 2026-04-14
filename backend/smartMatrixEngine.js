const ROUNDING_DIGITS = 2;
function round(v) { return Math.round(v * 10 ** ROUNDING_DIGITS) / 10 ** ROUNDING_DIGITS; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function makeRoom(id, type, zone, x, y, width, height, extra = {}) {
  return { id, type, zone, x: round(x), y: round(y), width: round(width), height: round(height), ...extra };
}

export function generateSmartLayout(raw) {
  const W = Number(raw.plotWidth) || 30;
  const H = Number(raw.plotHeight) || 60;
  const boundaries = raw.boundaries || { north: "covered", east: "open", south: "front", west: "covered" };
  const numBeds = Math.min(6, Math.max(1, Number(raw.bedrooms) || 3));
  const numBaths = Math.min(4, Math.max(1, Number(raw.bathrooms) || 2));

  let rooms = [];

  // Phase 1: Anchor the Fixed Core (Stairs & Lift)
  const coreW = 10;
  const coreH = 15;
  let coreX = 0;
  let coreY = H - coreH; // Snapped to front/bottom (y = H)

  if (boundaries.east === "covered" || boundaries.west === "open") {
    coreX = W - coreW; // Snap to east
  } else {
    coreX = 0; // Snap to west
  }
  rooms.push(makeRoom("staircase", "Staircase", "service", coreX, coreY, coreW, coreH));

  // Phase 2: Anchor the Breathable Edge (Balcony)
  let topY = 0;
  let balconyEdge = null;
  for (const [dir, state] of Object.entries(boundaries)) {
    if (state === "open" && dir !== (raw.frontDirection || "south")) {
      balconyEdge = dir;
      break;
    }
  }

  if (balconyEdge === "north") {
    rooms.push(makeRoom("main_balcony", "Balcony", "outdoor", 0, 0, W, 4));
    topY = 4;
  } else if (balconyEdge === "east" || boundaries.east === "open") {
    let balcX = (coreX === W - coreW && coreY === 0) ? W - 4 : W - 4;
    rooms.push(makeRoom("main_balcony", "Balcony", "outdoor", balcX, 0, 4, H));
  } else if (balconyEdge === "west" || boundaries.west === "open") {
    rooms.push(makeRoom("main_balcony", "Balcony", "outdoor", 0, 0, 4, H));
  }

  // Phase 3: Snap High-Priority Rooms (Bedrooms & Attached Baths)
  let currY = topY;
  let currX = (balconyEdge === "west") ? 4 : 0;
  const maxX = (balconyEdge === "east") ? W - 4 : W;
  let rowH = 0;
  let bdx = 1;

  while(bdx <= numBeds) {
    const isMaster = bdx === 1;
    const needBath = bdx <= numBaths - (raw.dwellingType === 'flat' ? 0 : 1);
    
    // Strict Anti-Stretch: Honor maximums!
    const targetBedW = isMaster ? 12 : 11;
    const targetBedH = isMaster ? 14 : 12;
    const bathW = needBath ? 5 : 0;
    const bathH = needBath ? 7 : 0;
    
    const requiredW = targetBedW + bathW;
    
    if (currX + requiredW > maxX) {
      currX = (balconyEdge === "west") ? 4 : 0;
      currY += rowH;
      rowH = 0;
    }
    
    // Collision guard with core
    if (currY + targetBedH > coreY && currX < coreX + coreW && currX + requiredW > coreX) {
       currX = coreX + coreW;
       if (currX + requiredW > maxX) {
         break;
       }
    }

    rooms.push(makeRoom(`bed_${bdx}`, isMaster ? "Master Bedroom" : "Bedroom", "living", currX, currY, targetBedW, targetBedH));
    currX += targetBedW;
    
    if (needBath) {
      rooms.push(makeRoom(`bath_att_${bdx}`, "Attached Bath", "service", currX, currY, bathW, bathH));
      currX += bathW;
      rowH = Math.max(rowH, targetBedH, bathH);
    } else {
      rowH = Math.max(rowH, targetBedH);
    }
    bdx++;
  }

  let bedsBtmY = currY + rowH;

  // Phase 4: Route Wet Zone (Kitchen & Common Bath)
  let shaftW = 4, shaftH = 5;
  let kitchW = 8, kitchH = 10;
  let commonBathW = 5, commonBathH = 8;

  let wetX = (coreX === 0) ? W - kitchW - commonBathW - shaftW : 0;
  if (balconyEdge === "east" && wetX > 0) wetX -= 4;

  let wetY = bedsBtmY;
  // Prevent Y overlap with core vertical channel
  if (wetY + Math.max(kitchH, commonBathH) > coreY) {
    if (wetX < coreX + coreW && wetX + kitchW + commonBathW + shaftW > coreX) {
      // Force it above core
      wetY = coreY - Math.max(kitchH, commonBathH);
    }
  }

  rooms.push(makeRoom("shaft_1", "Shaft", "service", wetX, wetY, shaftW, Math.max(kitchH, commonBathH)));
  rooms.push(makeRoom("kitchen", "Kitchen", "service", wetX + shaftW, wetY, kitchW, kitchH));
  rooms.push(makeRoom("common_bath", "Common Bathroom", "service", wetX + shaftW + kitchW, wetY, commonBathW, commonBathH));

  // Phase 5: Fill the Void (Hall & Vestibule)
  // Hall Extraction Algorithm (Find largest negative space Rect)
  const rects = rooms.map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
  const isFree = (px, py) => !rects.some(r => px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h);

  let bestRect = { x: 0, y: 0, w: 0, h: 0, area: 0 };
  const step = 0.5;

  for (let y = topY; y < H; y+=step) {
    for (let x = 0; x < W; x+=step) {
      if (!isFree(x + 0.1, y + 0.1)) continue;
      
      let w = step;
      while (x + w < W && isFree(x + w + 0.1, y + 0.1)) w += step;
      
      let h = step;
      let hit = false;
      while (y + h < H && !hit) {
        for (let dx = 0; dx < w; dx += step) {
          if (!isFree(x + dx + 0.1, y + h + 0.1)) {
            hit = true; break;
          }
        }
        if (!hit) h += step;
      }
      
      if (w * h > bestRect.area) { // Finds the absolute largest internal bounding box
        bestRect = { x: round(x), y: round(y), w: round(w), h: round(h), area: w * h };
      }
    }
  }

  if (bestRect.area > 0) {
    let hy = bestRect.y;
    let hh = bestRect.h;

    // Vestibule Segregation Check
    if ((hy + hh) >= coreY && bestRect.w <= 12 && hh >= 14) {
      let vH = 5.5; // Vestibule depth
      rooms.push(makeRoom("vestibule", "Entry Lobby", "living", bestRect.x, hy + hh - vH, bestRect.w, vH));
      hh -= vH;
    }
    
    if (hh > 0) {
      rooms.push(makeRoom("hall", "Hall", "living", bestRect.x, hy, bestRect.w, hh));
    }
  }

  // Final sanity mapping
  rooms = rooms.map(r => ({ ...r, doors: [], windows: [] }));

  return {
    plot: { width: W, height: H, gaj: raw.plotGaj, shape: raw.plotShape },
    rooms,
    tier: "smart"
  };
}
