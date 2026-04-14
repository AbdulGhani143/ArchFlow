import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage, Text, Transformer, Arc } from "react-konva";

const BASE_GRID_CELLS = 256;
const CELLS_PER_FOOT = 4;
const GRID_SIZE = 1;
const MIN_ROOM_SIZE = 1;
const DOOR_WIDTH_FT = 3;
const DOOR_DEPTH_FT = 0.6;
const WINDOW_WIDTH_FT = 3;
const WINDOW_DEPTH_FT = 0.4;

/* ── Room catalog for the "Add Room" toolbar ── */
const ROOM_CATALOG = [
  { category: "Living", rooms: [
    { type: "Hall",            defaultW: 16, defaultH: 14 },
    { type: "Bedroom",         defaultW: 12, defaultH: 12 },
    { type: "Master Bedroom",  defaultW: 14, defaultH: 12 },
    { type: "Guest Room",      defaultW: 10, defaultH: 10 },
  ]},
  { category: "Service", rooms: [
    { type: "Kitchen",         defaultW: 10, defaultH: 10 },
    { type: "Common Bathroom", defaultW: 8,  defaultH: 6 },
    { type: "Attached Bath",   defaultW: 6,  defaultH: 6 },
    { type: "Shaft",           defaultW: 4,  defaultH: 5 },
    { type: "Laundry",         defaultW: 6,  defaultH: 6 },
    { type: "Back Utility",    defaultW: 12, defaultH: 6 },
  ]},
  { category: "Entry / Outdoor", rooms: [
    { type: "Entrance Porch",  defaultW: 12, defaultH: 7 },
    { type: "Entry Lobby",     defaultW: 10, defaultH: 7 },
    { type: "Staircase",       defaultW: 9,  defaultH: 9 },
    { type: "Parking",         defaultW: 14, defaultH: 9 },
    { type: "Front Yard",      defaultW: 12, defaultH: 8 },
    { type: "Balcony",         defaultW: 10, defaultH: 5 },
    { type: "Courtyard",       defaultW: 10, defaultH: 10 },
  ]},
];

/* ── Color palette for rooms ── */
const ROOM_COLORS = {
  Hall: "#e8f5e9",
  Bedroom: "#e3f2fd",
  "Master Bedroom": "#e3f2fd",
  "Bedroom 2": "#e3f2fd",
  "Bedroom 3": "#e3f2fd",
  "Bedroom 4": "#e3f2fd",
  "Bedroom 5": "#e3f2fd",
  "Bedroom 6": "#e3f2fd",
  "Guest Room": "#f3e5f5",
  Kitchen: "#fff3e0",
  "Common Bathroom": "#e0f7fa",
  "Attached Bath": "#e0f7fa",
  "Common Bath": "#e0f7fa",
  Shaft: "#efebe9",
  Laundry: "#fce4ec",
  "Back Utility": "#f5f5f5",
  "Entrance Porch": "#fff8e1",
  "Entry Lobby": "#fff8e1",
  Staircase: "#ede7f6",
  Parking: "#eceff1",
  "Front Yard": "#e8f5e9",
  Balcony: "#e1f5fe",
  Courtyard: "#e8f5e9",
};

const GHOST_FURNITURE = {
  "Master Bedroom": [
    { label: "King Bed",  w: 6.5, h: 6.5, anchor: "center-top", type: "bed" },
    { label: "Wardrobe",  w: 4,   h: 2,   anchor: "left-wall", type: "wardrobe" },
    { label: "Study",     w: 4,   h: 2,   anchor: "bottom-right", type: "study" }
  ],
  "Bedroom": [
    { label: "Queen Bed", w: 5,   h: 6.5, anchor: "center-top", type: "bed" },
    { label: "Wardrobe",  w: 4,   h: 2,   anchor: "left-wall", type: "wardrobe" },
  ],
  "Bedroom 2": [
    { label: "Queen Bed", w: 5,   h: 6.5, anchor: "center-top", type: "bed" },
    { label: "Wardrobe",  w: 4,   h: 2,   anchor: "left-wall", type: "wardrobe" },
  ],
  "Bedroom 3": [
    { label: "Single Bed", w: 3,  h: 6.5, anchor: "center-top", type: "bed" },
    { label: "Study",      w: 4,  h: 2,   anchor: "bottom-right", type: "study" },
  ],
  "Bedroom 4": [
    { label: "Single Bed", w: 3,  h: 6.5, anchor: "center-top", type: "bed" },
    { label: "Study",      w: 4,  h: 2,   anchor: "bottom-right", type: "study" },
  ],
  "Bedroom 5": [
    { label: "Single Bed", w: 3,  h: 6.5, anchor: "center-top", type: "bed" },
  ],
  "Bedroom 6": [
    { label: "Single Bed", w: 3,  h: 6.5, anchor: "center-top", type: "bed" },
  ],
  "Guest Room": [
    { label: "Single Bed", w: 3,  h: 6.5, anchor: "center-top", type: "bed" },
  ],
  "Kitchen": [
    { label: "Kitchen Counter", w: -1, h: -1, anchor: "l-shape-kitchen", type: "l-counter" },
    { label: "Fridge",     w: 3,  h: 2.5, anchor: "top-right", type: "fridge" },
  ],
  "Hall": [
    { label: "L-Sofa",       w: 7, h: 5,   anchor: "corner-bottom-left", type: "l-sofa" },
    { label: "Coffee Table", w: 4, h: 2.5, anchor: "center-sofa", type: "coffee-table" },
    { label: "TV Unit",      w: 5, h: 1.5, anchor: "right-wall", type: "tv" },
  ],
};

function getRoomColor(room) {
  return ROOM_COLORS[room.type] || ROOM_COLORS[room.roomType] || ROOM_COLORS[room.label] || "#f3f4f6";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function normalizePlotGrid(plotWidth, plotHeight) {
  return {
    columns: Math.max(BASE_GRID_CELLS, Math.round(plotWidth * CELLS_PER_FOOT)),
    rows: Math.max(BASE_GRID_CELLS, Math.round(plotHeight * CELLS_PER_FOOT)),
  };
}

function isHall(room) {
  return room?.id === "hall" || room?.type === "Hall" || room?.roomType === "Hall";
}

/* ── Full starter layout matching what the backend algorithm produces ── */
function buildStarterLayout(plotWidth, plotHeight) {
  const W = plotWidth;
  const H = plotHeight;

  // --- zone heights ---
  const backUtilityH = Math.max(6, snapToGrid(H * 0.1));
  const frontOpenH   = Math.max(8, snapToGrid(H * 0.14));
  const houseH       = H - backUtilityH - frontOpenH;
  const topBandH     = Math.max(12, snapToGrid(houseH * 0.34));
  const porchH       = clamp(snapToGrid(houseH * 0.14), 5, 9);
  const middleH      = houseH - topBandH - porchH;

  // --- zone y positions ---
  const backY   = 0;
  const topY    = backUtilityH;
  const middleY = topY + topBandH;
  const porchY  = middleY + middleH;
  const frontY  = porchY + porchH;

  // --- widths ---
  const serviceW    = Math.max(10, snapToGrid(W * 0.28));
  const hallW       = W - serviceW;
  const topLeftW    = snapToGrid(W * 0.5);
  const topRightW   = W - topLeftW;
  const bathAttachW = clamp(snapToGrid(topLeftW * 0.2), 5, 7);
  const bathH       = clamp(snapToGrid(middleH * 0.34 * 0.34), 5, snapToGrid(middleH * 0.34 * 0.45));
  const shaftW      = clamp(snapToGrid(serviceW * 0.22), 4, 6);
  const serviceTopH = snapToGrid(middleH * 0.56);
  const kitchenH    = serviceTopH - bathH;
  const bed3H       = middleH - serviceTopH;
  const laundryW    = snapToGrid(W * 0.28);
  const backMainW   = W - laundryW;
  const parkingW    = snapToGrid(W * 0.58);
  const frontYardW  = W - parkingW;

  return [
    // Back utility strip
    { id: "back_utility", type: "Back Utility",    label: "Back Utility",    x: 0,              y: backY,    width: backMainW,   height: backUtilityH },
    { id: "laundry",      type: "Laundry",         label: "Laundry",         x: backMainW,      y: backY,    width: laundryW,    height: backUtilityH },

    // Top band — bedrooms
    { id: "bed_1",        type: "Master Bedroom",  label: "Master Bedroom",  x: 0,              y: topY,     width: snapToGrid(topLeftW - bathAttachW), height: topBandH },
    { id: "attached_bath_1", type: "Attached Bath", label: "Master Bath",    x: snapToGrid(topLeftW - bathAttachW), y: topY, width: bathAttachW, height: topBandH },
    { id: "bed_2",        type: "Bedroom 2",       label: "Bedroom 2",       x: topLeftW,       y: topY,     width: topRightW,   height: topBandH },

    // Middle — Hall (anchor floor, index 0 after sort)
    { id: "hall",         type: "Hall",            label: "Hall",            x: 0,              y: middleY,  width: hallW,       height: middleH },

    // Middle right — service stack
    { id: "common_bath",  type: "Common Bathroom", label: "Common Bath",     x: hallW,          y: middleY,  width: snapToGrid(serviceW * 0.6), height: bathH },
    { id: "shaft",        type: "Shaft",           label: "Shaft",           x: snapToGrid(hallW + serviceW * 0.6), y: middleY, width: snapToGrid(serviceW * 0.4), height: bathH },
    { id: "kitchen",      type: "Kitchen",         label: "Kitchen",         x: hallW,          y: snapToGrid(middleY + bathH), width: serviceW, height: kitchenH },
    { id: "bed_3",        type: "Bedroom 3",       label: "Bedroom 3",       x: hallW,          y: snapToGrid(middleY + serviceTopH), width: serviceW, height: bed3H },

    // Front — porch
    { id: "porch",        type: "Entrance Porch",  label: "Entrance Porch",  x: snapToGrid(hallW * 0.15), y: porchY, width: snapToGrid(hallW * 0.7), height: porchH },

    // Front open strip — parking + yard
    { id: "parking",      type: "Parking",         label: "Parking",         x: 0,              y: frontY,   width: parkingW,    height: frontOpenH },
    { id: "front_yard",   type: "Front Yard",      label: "Front Yard",      x: parkingW,       y: frontY,   width: frontYardW,  height: frontOpenH },
  ];
}

function sortRoomsWithHallBase(rooms) {
  const hallRooms = rooms.filter((room) => isHall(room));
  const otherRooms = rooms.filter((room) => !isHall(room));
  return [...hallRooms, ...otherRooms];
}

/**
 * Normalize incoming rooms from the backend algorithm.
 * Empty input should remain empty so backend failures stay visible in the UI.
 */
function normalizeIncomingRooms(initialRooms) {
  if (!Array.isArray(initialRooms) || initialRooms.length === 0) {
    return [];
  }

  return sortRoomsWithHallBase(
    initialRooms.map((room, index) => ({
      id: String(room.id ?? room.roomId ?? room.type ?? room.roomType ?? `room-${index + 1}`),
      label: room.label ?? room.roomType ?? room.type ?? `Room ${index + 1}`,
      type: room.type ?? room.roomType ?? room.label ?? `Room ${index + 1}`,
      roomType: room.roomType ?? room.type ?? room.label ?? `Room ${index + 1}`,
      x: Number(room.x) || 0,
      y: Number(room.y) || 0,
      width: Number(room.width) || 0,
      height: Number(room.height) || 0,
      doors: Array.isArray(room.doors) ? room.doors : [],
      windows: Array.isArray(room.windows) ? room.windows : [],
    })),
  );
}

/* ── Wall helpers ── */

/**
 * Determine which wall of `room` faces the hall, if any.
 * Returns "top" | "bottom" | "left" | "right" | null
 */
function wallFacingHall(room, allRooms) {
  const hall = allRooms.find((r) => isHall(r));
  if (!hall || room.id === hall.id) return null;

  const tolerance = 1;

  // Room's bottom edge touches Hall's top edge
  if (Math.abs((room.y + room.height) - hall.y) < tolerance &&
      room.x < hall.x + hall.width && room.x + room.width > hall.x) {
    return "bottom";
  }
  // Room's top edge touches Hall's bottom edge
  if (Math.abs(room.y - (hall.y + hall.height)) < tolerance &&
      room.x < hall.x + hall.width && room.x + room.width > hall.x) {
    return "top";
  }
  // Room's right edge touches Hall's left edge
  if (Math.abs((room.x + room.width) - hall.x) < tolerance &&
      room.y < hall.y + hall.height && room.y + room.height > hall.y) {
    return "right";
  }
  // Room's left edge touches Hall's right edge
  if (Math.abs(room.x - (hall.x + hall.width)) < tolerance &&
      room.y < hall.y + hall.height && room.y + room.height > hall.y) {
    return "left";
  }

  return null;
}

/**
 * Determine which walls of a room are "external" (on plot boundary or
 * not significantly shared with another room).
 */
function wallsAreAdjacent(r1, wall1, r2) {
  const t = 1;
  if (wall1 === "top" && Math.abs(r1.y - (r2.y + r2.height)) < t) return true;
  if (wall1 === "bottom" && Math.abs((r1.y + r1.height) - r2.y) < t) return true;
  if (wall1 === "left" && Math.abs(r1.x - (r2.x + r2.width)) < t) return true;
  if (wall1 === "right" && Math.abs((r1.x + r1.width) - r2.x) < t) return true;
  return false;
}

function wallToCardinal(room, wall, plotWidth, plotHeight) {
  const tolerance = 1;
  switch (wall) {
    case "top":    return room.y < tolerance ? "north" : null;
    case "bottom": return (room.y + room.height) > plotHeight - tolerance ? "south" : null;
    case "left":   return room.x < tolerance ? "west" : null;
    case "right":  return (room.x + room.width) > plotWidth - tolerance ? "east" : null;
  }
  return null;
}

function getVentilationWalls(room, allRooms, plotWidth, plotHeight, boundaries) {
  const validWalls = [];
  
  for (const wall of ["top", "bottom", "left", "right"]) {
    const cardinal = wallToCardinal(room, wall, plotWidth, plotHeight);
    
    if (cardinal) {
      // Wall is on the plot boundary
      const status = boundaries[cardinal];
      if (status === "front" || status === "open") {
        validWalls.push(wall);
        continue;
      }
    }
    
    // Check if wall touches a Shaft or Balcony
    const touchesShaftOrBalcony = allRooms.some(other => {
      if (other.id === room.id) return false;
      if (other.type !== "Shaft" && other.type !== "Balcony") return false;
      return wallsAreAdjacent(room, wall, other);
    });
    
    if (touchesShaftOrBalcony) {
      validWalls.push(wall);
    }
  }
  return validWalls;
}

function getExternalWalls(room, allRooms, plotWidth, plotHeight) {
  const walls = [];
  const tolerance = 1;

  // Check each wall
  const checks = [
    { wall: "top",    onBoundary: room.y < tolerance },
    { wall: "bottom", onBoundary: (room.y + room.height) > plotHeight - tolerance },
    { wall: "left",   onBoundary: room.x < tolerance },
    { wall: "right",  onBoundary: (room.x + room.width) > plotWidth - tolerance },
  ];

  for (const { wall, onBoundary } of checks) {
    if (onBoundary) {
      walls.push(wall);
      continue;
    }

    // Check if this wall is shared with another room
    let isShared = false;
    for (const other of allRooms) {
      if (other.id === room.id) continue;

      if (wall === "top" && Math.abs(room.y - (other.y + other.height)) < tolerance) {
        const overlapStart = Math.max(room.x, other.x);
        const overlapEnd = Math.min(room.x + room.width, other.x + other.width);
        if ((overlapEnd - overlapStart) > room.width * 0.5) { isShared = true; break; }
      }
      if (wall === "bottom" && Math.abs((room.y + room.height) - other.y) < tolerance) {
        const overlapStart = Math.max(room.x, other.x);
        const overlapEnd = Math.min(room.x + room.width, other.x + other.width);
        if ((overlapEnd - overlapStart) > room.width * 0.5) { isShared = true; break; }
      }
      if (wall === "left" && Math.abs(room.x - (other.x + other.width)) < tolerance) {
        const overlapStart = Math.max(room.y, other.y);
        const overlapEnd = Math.min(room.y + room.height, other.y + other.height);
        if ((overlapEnd - overlapStart) > room.height * 0.5) { isShared = true; break; }
      }
      if (wall === "right" && Math.abs((room.x + room.width) - other.x) < tolerance) {
        const overlapStart = Math.max(room.y, other.y);
        const overlapEnd = Math.min(room.y + room.height, other.y + other.height);
        if ((overlapEnd - overlapStart) > room.height * 0.5) { isShared = true; break; }
      }
    }

    if (!isShared) {
      walls.push(wall);
    }
  }

  return walls;
}

/**
 * Compute the pixel position and size of a door/window element on a room boundary.
 */
function getElementPixelRect(element, room, plotWidth, plotHeight, stageWidth, stageHeight, depthFt) {
  const pxPerUnitX = stageWidth / plotWidth;
  const pxPerUnitY = stageHeight / plotHeight;
  const widthPx = element.width * pxPerUnitX;
  const depthPx = depthFt * Math.max(pxPerUnitX, pxPerUnitY);
  const roomWPx = room.width * pxPerUnitX;
  const roomHPx = room.height * pxPerUnitY;

  let x = 0, y = 0, w = widthPx, h = depthPx;

  switch (element.wall) {
    case "top":
      x = element.position * (roomWPx - widthPx);
      y = -depthPx / 2;
      break;
    case "bottom":
      x = element.position * (roomWPx - widthPx);
      y = roomHPx - depthPx / 2;
      break;
    case "left":
      w = depthPx;
      h = widthPx;
      x = -depthPx / 2;
      y = element.position * (roomHPx - widthPx);
      break;
    case "right":
      w = depthPx;
      h = widthPx;
      x = roomWPx - depthPx / 2;
      y = element.position * (roomHPx - widthPx);
      break;
    default:
      break;
  }

  return { x, y, w, h };
}


function computeFurniturePosition(item, room, pxX, pxY) {
  let cx = 0, cy = 0;
  const rw = room.width * pxX;
  const rh = room.height * pxY;
  const fw = item.w === -1 ? rw : item.w * pxX;
  const fh = item.h === -1 ? rh : item.h * pxY;

  switch (item.anchor) {
    case "center":
      cx = (rw - fw) / 2; cy = (rh - fh) / 2; break;
    case "center-top":
      cx = (rw - fw) / 2; cy = 1 * pxY; break;
    case "left-wall":
      cx = 0; cy = (rh - fh) / 2; break;
    case "right-wall":
      cx = rw - fw; cy = (rh - fh) / 2; break;
    case "bottom-wall":
      cx = (rw - fw) / 2; cy = rh - fh; break;
    case "top-wall":
      cx = (rw - fw) / 2; cy = 0; break;
    case "top-right":
      cx = rw - fw; cy = 0; break;
    case "bottom-right":
      cx = rw - fw; cy = rh - fh; break;
    case "center-bottom":
      cx = (rw - fw) / 2; cy = rh - fh - (1 * pxY); break;
    case "corner-bottom-left":
      cx = 1 * pxX; cy = rh - fh - (1 * pxY); break;
    case "center-sofa":
      cx = (1 * pxX) + (7 * pxX - fw) / 2 + (1.5 * pxX); cy = rh - (5 * pxY) + (5 * pxY - fh) / 2; break;
    case "l-shape-kitchen":
      cx = 0; cy = 0; break;
    default:
      cx = 0; cy = 0;
  }
  return { x: cx, y: cy, w: fw, h: fh };
}

/* ── Compass component ── */
function CompassIndicator({ frontDirection, stageWidth }) {
  const size = 40;
  const margin = 12;
  const cx = stageWidth - size / 2 - margin;
  const cy = size / 2 + margin;

  const directionAngles = { north: 0, east: 90, south: 180, west: 270 };
  const angle = directionAngles[frontDirection] || 0;

  // Arrow pointing to "front" direction
  const arrowLength = 14;
  const rad = ((angle - 90) * Math.PI) / 180;
  const ax = cx + Math.cos(rad) * arrowLength;
  const ay = cy + Math.sin(rad) * arrowLength;

  return (
    <Group listening={false}>
      {/* Background circle */}
      <Rect
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        cornerRadius={size / 2}
        fill="rgba(255,255,255,0.92)"
        stroke="#78716c"
        strokeWidth={1}
      />
      {/* N label */}
      <Text
        x={cx - 4}
        y={cy - size / 2 + 2}
        text="N"
        fontSize={8}
        fontFamily="sans-serif"
        fontStyle="bold"
        fill="#111"
        listening={false}
      />
      {/* Arrow line */}
      <Line
        points={[cx, cy, ax, ay]}
        stroke="#16a34a"
        strokeWidth={2.5}
        lineCap="round"
      />
      {/* Center dot */}
      <Rect
        x={cx - 2}
        y={cy - 2}
        width={4}
        height={4}
        cornerRadius={2}
        fill="#111"
      />
      {/* Front label */}
      <Text
        x={cx - size / 2}
        y={cy + size / 2 + 2}
        width={size}
        text={`Front: ${frontDirection.charAt(0).toUpperCase() + frontDirection.slice(1)}`}
        fontSize={7}
        fontFamily="sans-serif"
        fill="#78716c"
        align="center"
        listening={false}
      />
    </Group>
  );
}

/* ── Plot Boundary Overlay ── */
function PlotBoundaryOverlay({ boundaries, stageWidth, stageHeight }) {
  const edges = {
    north: { points: [0, 0, stageWidth, 0] },
    south: { points: [0, stageHeight, stageWidth, stageHeight] },
    east:  { points: [stageWidth, 0, stageWidth, stageHeight] },
    west:  { points: [0, 0, 0, stageHeight] }
  };

  return (
    <Group listening={false}>
      {Object.entries(boundaries).map(([dir, status]) => {
        const { points } = edges[dir];
        let stroke = "#d1d5db"; // default covered
        let strokeW = 4;
        let dash = [];

        if (status === "front") {
          stroke = "#16a34a"; // green
          dash = [8, 4];
        } else if (status === "open") {
          stroke = "#3b82f6"; // blue
          dash = [4, 4];
          strokeW = 2;
        } else {
          // Hatched looking default
          dash = [2, 4];
        }

        return (
          <Group key={dir}>
            <Line points={points} stroke={stroke} strokeWidth={strokeW} dash={dash} />
          </Group>
        );
      })}
    </Group>
  );
}


function GridFloorPlanEditor({
  plotWidth = 40,
  plotHeight = 50,
  initialRooms = [],
  frontDirection = "south",
  dwellingType = "house",
  boundaries = { north: "covered", south: "front", east: "open", west: "covered" },
}) {
  const [rooms, setRooms] = useState(() => normalizeIncomingRooms(initialRooms));
  const [selectedId, setSelectedId] = useState(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [showFurniture, setShowFurniture] = useState(false);
  const [stageWidth, setStageWidth] = useState(960);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const wrapperRef = useRef(null);
  const transformerRef = useRef(null);
  const groupRefs = useRef(new Map());
  const shapeRefs = useRef(new Map());

  /* Counter for generating unique IDs when adding rooms manually */
  const addCounterRef = useRef(0);
  const doorCounterRef = useRef(0);
  const windowCounterRef = useRef(0);

  const grid = useMemo(
    () => normalizePlotGrid(plotWidth, plotHeight),
    [plotHeight, plotWidth],
  );

  useEffect(() => {
    if (!wrapperRef.current) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width;

      if (nextWidth) {
        setStageWidth(Math.max(320, Math.min(1100, nextWidth - 24)));
      }
    });

    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const stageHeight = Math.round(stageWidth * (plotHeight / plotWidth));
  const cellWidth = stageWidth / grid.columns;
  const cellHeight = stageHeight / grid.rows;
  const pixelsPerPlotUnitX = stageWidth / plotWidth;
  const pixelsPerPlotUnitY = stageHeight / plotHeight;

  /* When the backend returns a new layout, hydrate it immediately.
     This is the "algorithm-first" rule: whatever the backend returns
     completely replaces the canvas state. */
  useEffect(() => {
    setRooms(normalizeIncomingRooms(initialRooms));
    setSelectedId(null);
    setIsTransforming(false);
  }, [initialRooms]);

  useEffect(() => {
    // ── Z-ORDER EFFECT ──
    const hallNode = groupRefs.current.get("hall");
    if (hallNode) hallNode.moveToBottom();

    if (selectedId && selectedId !== "hall") {
      const topNode = groupRefs.current.get(selectedId);
      if (topNode) topNode.moveToTop();
    }
  }, [selectedId, rooms]);

  useLayoutEffect(() => {
    const hallNode = groupRefs.current.get("hall");
    const selectedNode = selectedId ? groupRefs.current.get(selectedId) : null;
    const layer = selectedNode?.getLayer() ?? hallNode?.getLayer();

    if (!layer) {
      return;
    }

    hallNode?.moveToBottom();

    if (selectedNode && selectedId !== "hall") {
      selectedNode.moveToTop();
    }

    layer.batchDraw();
  }, [selectedId, rooms]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const node = selectedId ? shapeRefs.current.get(selectedId) : null;

    if (!transformer) {
      return;
    }

    if (node) {
      transformer.nodes([node]);
    } else {
      transformer.nodes([]);
    }

    transformer.getLayer()?.batchDraw();
  }, [rooms, selectedId]);

  const gridLines = useMemo(() => {
    const lines = [];

    for (let column = 0; column <= grid.columns; column += 1) {
      const x = column * cellWidth;
      lines.push(
        <Line
          key={`column-${column}`}
          listening={false}
          points={[x, 0, x, stageHeight]}
          stroke={column % 16 === 0 ? "#c9c9c9" : "#e7e7e7"}
          strokeWidth={column % 16 === 0 ? 0.8 : 0.35}
        />,
      );
    }

    for (let row = 0; row <= grid.rows; row += 1) {
      const y = row * cellHeight;
      lines.push(
        <Line
          key={`row-${row}`}
          listening={false}
          points={[0, y, stageWidth, y]}
          stroke={row % 16 === 0 ? "#c9c9c9" : "#e7e7e7"}
          strokeWidth={row % 16 === 0 ? 0.8 : 0.35}
        />,
      );
    }

    return lines;
  }, [cellHeight, cellWidth, grid.columns, grid.rows, stageHeight, stageWidth]);

  const updateRoom = (roomId, nextPartial) => {
    setRooms((currentRooms) =>
      currentRooms.map((room) => (room.id === roomId ? { ...room, ...nextPartial } : room)),
    );
  };

  const activateRoom = (roomId) => {
    setSelectedId(roomId);
  };

  const bindGroupRef = (roomId, node) => {
    if (!node) groupRefs.current.delete(roomId);
    else groupRefs.current.set(roomId, node);
  };

  const bindShapeRef = (roomId, node) => {
    if (!node) shapeRefs.current.delete(roomId);
    else shapeRefs.current.set(roomId, node);
  };

  /* ── Add Room handler ── */
  const addRoom = (roomType, defaultW, defaultH) => {
    addCounterRef.current += 1;
    const suffix = addCounterRef.current;
    const newId = `${roomType.toLowerCase().replace(/\s+/g, "_")}_${suffix}`;

    // Clamp default size to the plot and snap to grid
    let w = snapToGrid(Math.min(defaultW, plotWidth));
    let h = snapToGrid(Math.min(defaultH, plotHeight));

    // Default positioning
    let x, y;

    // Balcony: place on front side
    if (roomType === "Balcony") {
      switch (frontDirection) {
        case "north":
          x = snapToGrid((plotWidth - w) / 2);
          y = 0;
          break;
        case "south":
          x = snapToGrid((plotWidth - w) / 2);
          y = snapToGrid(plotHeight - h);
          break;
        case "east":
          // Rotate dimensions for side placement
          [w, h] = [h, w];
          x = snapToGrid(plotWidth - w);
          y = snapToGrid((plotHeight - h) / 2);
          break;
        case "west":
          [w, h] = [h, w];
          x = 0;
          y = snapToGrid((plotHeight - h) / 2);
          break;
        default:
          x = snapToGrid((plotWidth - w) / 2);
          y = snapToGrid(plotHeight - h);
      }
    } else {
      // Drop near the center of the plot
      x = snapToGrid(clamp((plotWidth - w) / 2, 0, plotWidth - w));
      y = snapToGrid(clamp((plotHeight - h) / 2, 0, plotHeight - h));
    }

    const newRoom = {
      id: newId,
      type: roomType,
      roomType: roomType,
      label: roomType,
      x,
      y,
      width: w,
      height: h,
      doors: [],
      windows: [],
    };

    setRooms((currentRooms) => {
      // Hall stays at index 0, new room goes to the end
      const hallRooms = currentRooms.filter((entry) => isHall(entry));
      const otherRooms = currentRooms.filter((entry) => !isHall(entry));
      return [...hallRooms, ...otherRooms, newRoom];
    });

    // Immediately select the new room so the user can position it
    setSelectedId(newId);
  };

  /* ── Export Layout Schema ── */
  const handleCopySchema = () => {
    const cleanRooms = rooms.map(room => ({
      id: room.id,
      type: room.type,
      zone: room.zone || room.roomType, // fallback if zone is missing
      x: room.x,
      y: room.y,
      width: room.width,
      height: room.height
    }));

    const payload = {
      plot: { width: plotWidth, height: plotHeight, front: frontDirection },
      boundaries: boundaries,
      layout: cleanRooms
    };

    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      .then(() => {
        setCopyFeedback("Copied!");
        setTimeout(() => setCopyFeedback(null), 2000);
      })
      .catch(err => {
        console.error("Failed to copy schema: ", err);
        setCopyFeedback("Failed!");
        setTimeout(() => setCopyFeedback(null), 2000);
      });
  };

  /* ── Delete selected room ── */
  const deleteSelectedRoom = () => {
    if (!selectedId) return;
    // Don't allow deleting the hall
    if (selectedId === "hall") return;
    setRooms((currentRooms) => currentRooms.filter((room) => room.id !== selectedId));
    setSelectedId(null);
  };

  /* ── Add Door to selected room ── */
  const addDoorToRoom = () => {
    if (!selectedId) return;
    const room = rooms.find((r) => r.id === selectedId);
    if (!room) return;

    doorCounterRef.current += 1;
    const doorId = `door_${doorCounterRef.current}`;

    // Prefer wall facing hall
    let wall = wallFacingHall(room, rooms);
    if (!wall) {
      // Pick first wall that doesn't already have too many doors
      const wallCandidates = ["bottom", "top", "right", "left"];
      const existingDoorWalls = (room.doors || []).map(d => d.wall);
      wall = wallCandidates.find(w => !existingDoorWalls.includes(w)) || "bottom";
    }

    const newDoor = {
      id: doorId,
      wall,
      position: 0.5,
      width: Math.min(DOOR_WIDTH_FT, wall === "left" || wall === "right" ? room.height - 1 : room.width - 1),
    };

    updateRoom(selectedId, {
      doors: [...(room.doors || []), newDoor],
    });
  };

  /* ── Add Window to selected room ── */
  const addWindowToRoom = () => {
    if (!selectedId) return;
    const room = rooms.find((r) => r.id === selectedId);
    if (!room) return;

    windowCounterRef.current += 1;
    const winId = `win_${windowCounterRef.current}`;

    // Only allow windows on ventilation walls
    const ventWalls = getVentilationWalls(room, rooms, plotWidth, plotHeight, boundaries);
    if (ventWalls.length === 0) {
      alert("No valid ventilation wall available. Place this room against an open boundary, a Shaft, or a Balcony.");
      return; 
    }

    // Pick one that doesn't already have a window
    const existingWinWalls = (room.windows || []).map(w => w.wall);
    const wall = ventWalls.find(w => !existingWinWalls.includes(w)) || ventWalls[0];

    const newWindow = {
      id: winId,
      wall,
      position: 0.5,
      width: Math.min(WINDOW_WIDTH_FT, wall === "left" || wall === "right" ? room.height - 1 : room.width - 1),
    };

    updateRoom(selectedId, {
      windows: [...(room.windows || []), newWindow],
    });
  };

  /* ── Remove Door ── */
  const removeDoor = (roomId, doorId) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    updateRoom(roomId, {
      doors: (room.doors || []).filter(d => d.id !== doorId),
    });
  };

  /* ── Remove Window ── */
  const removeWindow = (roomId, winId) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    updateRoom(roomId, {
      windows: (room.windows || []).filter(w => w.id !== winId),
    });
  };

  /* ── Update door/window state (wall and position along wall) ── */
  const updateDoorState = (roomId, doorId, partialState) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    updateRoom(roomId, {
      doors: (room.doors || []).map(d => d.id === doorId ? { ...d, ...partialState } : d),
    });
  };

  const updateWindowState = (roomId, winId, partialState) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    updateRoom(roomId, {
      windows: (room.windows || []).map(w => w.id === winId ? { ...w, ...partialState } : w),
    });
  };

  const getElementDragBound = (pos, element, room, depthFt) => {
    const groupNode = groupRefs.current.get(room.id);
    if (!groupNode) return pos;
    
    const groupPos = groupNode.absolutePosition();
    const roomWidthPx = (room.width / plotWidth) * stageWidth;
    const roomHeightPx = (room.height / plotHeight) * stageHeight;
    const widthPx = element.width * pixelsPerPlotUnitX;
    const depthPx = depthFt * Math.max(pixelsPerPlotUnitX, pixelsPerPlotUnitY);

    const relX = pos.x - groupPos.x;
    const relY = pos.y - groupPos.y;

    const distTop = Math.abs(relY);
    const distBottom = Math.abs(relY - roomHeightPx);
    const distLeft = Math.abs(relX);
    const distRight = Math.abs(relX - roomWidthPx);
    const minDist = Math.min(distTop, distBottom, distLeft, distRight);

    if (minDist === distTop) {
      return { x: clamp(pos.x, groupPos.x, groupPos.x + roomWidthPx - widthPx), y: groupPos.y - depthPx / 2 };
    } else if (minDist === distBottom) {
      return { x: clamp(pos.x, groupPos.x, groupPos.x + roomWidthPx - widthPx), y: groupPos.y + roomHeightPx - depthPx / 2 };
    } else if (minDist === distLeft) {
      return { x: groupPos.x - depthPx / 2, y: clamp(pos.y, groupPos.y, groupPos.y + roomHeightPx - widthPx) };
    } else {
      return { x: groupPos.x + roomWidthPx - depthPx / 2, y: clamp(pos.y, groupPos.y, groupPos.y + roomHeightPx - widthPx) };
    }
  };

  const handleElementDragEnd = (e, element, room, updateStateFn) => {
    const groupNode = groupRefs.current.get(room.id);
    if (!groupNode) return;
    
    const groupPos = groupNode.absolutePosition();
    const roomWidthPx = (room.width / plotWidth) * stageWidth;
    const roomHeightPx = (room.height / plotHeight) * stageHeight;
    const widthPx = element.width * pixelsPerPlotUnitX;

    const absPos = e.target.absolutePosition();
    const relX = absPos.x - groupPos.x;
    const relY = absPos.y - groupPos.y;

    const distTop = Math.abs(relY);
    const distBottom = Math.abs(relY - roomHeightPx);
    const distLeft = Math.abs(relX);
    const distRight = Math.abs(relX - roomWidthPx);
    const minDist = Math.min(distTop, distBottom, distLeft, distRight);

    let newWall, newPosRaw;
    if (minDist === distTop) {
      newWall = "top";
      newPosRaw = roomWidthPx - widthPx > 0 ? clamp(relX / (roomWidthPx - widthPx), 0, 1) : 0.5;
    } else if (minDist === distBottom) {
      newWall = "bottom";
      newPosRaw = roomWidthPx - widthPx > 0 ? clamp(relX / (roomWidthPx - widthPx), 0, 1) : 0.5;
    } else if (minDist === distLeft) {
      newWall = "left";
      newPosRaw = roomHeightPx - widthPx > 0 ? clamp(relY / (roomHeightPx - widthPx), 0, 1) : 0.5;
    } else {
      newWall = "right";
      newPosRaw = roomHeightPx - widthPx > 0 ? clamp(relY / (roomHeightPx - widthPx), 0, 1) : 0.5;
    }
    
    updateStateFn(room.id, element.id, { wall: newWall, position: newPosRaw });
  };

  const handleElementDragMove = (e, element, room, depthFt) => {
    const node = e.target;
    const groupNode = groupRefs.current.get(room.id);
    if (!groupNode) return;

    const groupPos = groupNode.absolutePosition();
    const roomWidthPx = (room.width / plotWidth) * stageWidth;
    const roomHeightPx = (room.height / plotHeight) * stageHeight;

    const absPos = node.absolutePosition();
    const relX = absPos.x - groupPos.x;
    const relY = absPos.y - groupPos.y;

    const distTop = Math.abs(relY);
    const distBottom = Math.abs(relY - roomHeightPx);
    const distLeft = Math.abs(relX);
    const distRight = Math.abs(relX - roomWidthPx);
    const minDist = Math.min(distTop, distBottom, distLeft, distRight);

    let currentWall;
    if (minDist === distTop) currentWall = "top";
    else if (minDist === distBottom) currentWall = "bottom";
    else if (minDist === distLeft) currentWall = "left";
    else currentWall = "right";

    // Dynamically update Rect dimensions
    const widthPx = element.width * pixelsPerPlotUnitX;
    const depthPx = depthFt * Math.max(pixelsPerPlotUnitX, pixelsPerPlotUnitY);

    if (currentWall === "top" || currentWall === "bottom") {
      node.width(widthPx);
      node.height(depthPx);
    } else {
      node.width(depthPx);
      node.height(widthPx);
    }

    // Identify and update sibling primitives synchronously
    const parentGroup = node.parent;
    if (!parentGroup) return;

    const arcNode = parentGroup.findOne('Arc');
    if (arcNode) {
      const rectX = node.x();
      const rectY = node.y();
      const w = node.width();
      const h = node.height();
      const arcRadius = Math.min(w, h) * 1.5;
      
      let arcX = rectX, arcY = rectY, rotation = 0;
      if (currentWall === "bottom") {
        arcX = rectX; arcY = rectY; rotation = -90;
      } else if (currentWall === "top") {
        arcX = rectX + w; arcY = rectY + h; rotation = 90;
      } else if (currentWall === "left") {
        arcX = rectX + w; arcY = rectY; rotation = 0;
      } else if (currentWall === "right") {
        arcX = rectX; arcY = rectY + h; rotation = 180;
      }
      arcNode.setAttrs({ x: arcX, y: arcY, outerRadius: arcRadius, rotation: rotation });
    }

    const lineNode = parentGroup.findOne('Line');
    if (lineNode) {
      const rectX = node.x();
      const rectY = node.y();
      const w = node.width();
      const h = node.height();
      
      if (currentWall === "top" || currentWall === "bottom") {
        lineNode.points([rectX + w / 2, rectY, rectX + w / 2, rectY + h]);
      } else {
        lineNode.points([rectX, rectY + h / 2, rectX + w, rectY + h / 2]);
      }
    }
  };

  /* ── Get the currently selected room object ── */
  const selectedRoom = selectedId ? rooms.find((r) => r.id === selectedId) : null;

  /* ── Filter the catalog: hide Balcony for houses ── */
  const filteredCatalog = ROOM_CATALOG.map((cat) => ({
    ...cat,
    rooms: cat.rooms.filter((entry) => {
      if (entry.type === "Balcony" && dwellingType !== "flat") return false;
      return true;
    }),
  })).filter((cat) => cat.rooms.length > 0);

  return (
    <div className="editor-shell">
      <div className="furniture-toggle-container">
        <button 
          className={`furniture-toggle-btn ${showFurniture ? 'active' : ''}`}
          onClick={() => setShowFurniture(!showFurniture)}
        >
          {showFurniture ? "🪑 Hide Furniture" : "🪑 Show Furniture"}
        </button>
      </div>
      <div
        className="editor-canvas"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedId(null);
          }
        }}
        ref={wrapperRef}
      >
        {rooms.length === 0 ? (
          <div className="editor-empty-state">
            <p>No layout loaded yet.</p>
            <p>Choose your plot details and click Generate Layout.</p>
          </div>
        ) : null}
        <Stage
          height={stageHeight}
          onMouseDown={(event) => {
            if (event.target === event.target.getStage()) {
              setSelectedId(null);
            }
          }}
          width={stageWidth}
        >
          <Layer listening={false}>
            {gridLines}
            <Rect
              fill="transparent"
              height={stageHeight}
              stroke="black"
              strokeWidth={1.2}
              width={stageWidth}
              x={0}
              y={0}
            />
            {/* Plot Boundary overlay */}
            <PlotBoundaryOverlay
              boundaries={boundaries}
              stageWidth={stageWidth}
              stageHeight={stageHeight}
            />
          </Layer>

          <Layer>
            {rooms.map((room) => {
              const roomWidthPx = (room.width / plotWidth) * stageWidth;
              const roomHeightPx = (room.height / plotHeight) * stageHeight;
              const roomX = (room.x / plotWidth) * stageWidth;
              const roomY = (room.y / plotHeight) * stageHeight;
              const labelFontSize = Math.max(
                10,
                Math.min(15, roomWidthPx * 0.08, roomHeightPx * 0.2),
              );
              const dimensionFontSize = Math.max(
                9,
                Math.min(13, roomWidthPx * 0.07, roomHeightPx * 0.16),
              );
              const labelTextHeight = labelFontSize + 6;
              const dimensionTextHeight = dimensionFontSize + 6;
              const labelY = Math.max(6, (roomHeightPx / 2) - labelTextHeight);
              const dimensionY = Math.min(
                roomHeightPx - dimensionTextHeight - 4,
                (roomHeightPx / 2) + 4,
              );

              const isSelected = room.id === selectedId;
              let isOverlapping = false;
              for (const other of rooms) {
                if (other.id === room.id) continue;
                if (isHall(room) || isHall(other)) continue;
                
                const overlapTolerance = 0.5;
                if (
                  room.x < other.x + other.width - overlapTolerance &&
                  room.x + room.width > other.x + overlapTolerance &&
                  room.y < other.y + other.height - overlapTolerance &&
                  room.y + room.height > other.y + overlapTolerance
                ) {
                  isOverlapping = true;
                  break;
                }
              }

              return (
                <Group
                  dragBoundFunc={(position) => {
                    const nextX = clamp(
                      position.x / pixelsPerPlotUnitX,
                      0,
                      Math.max(0, plotWidth - room.width),
                    );
                    const nextY = clamp(
                      position.y / pixelsPerPlotUnitY,
                      0,
                      Math.max(0, plotHeight - room.height),
                    );

                    return {
                      x: nextX * pixelsPerPlotUnitX,
                      y: nextY * pixelsPerPlotUnitY,
                    };
                  }}
                  draggable
                  key={room.id}
                  onClick={() => activateRoom(room.id)}
                  onDragStart={() => activateRoom(room.id)}
                  onDragEnd={(event) => {
                    updateRoom(room.id, {
                      x: clamp(
                        event.target.x() / pixelsPerPlotUnitX,
                        0,
                        Math.max(0, plotWidth - room.width),
                      ),
                      y: clamp(
                        event.target.y() / pixelsPerPlotUnitY,
                        0,
                        Math.max(0, plotHeight - room.height),
                      ),
                    });
                  }}
                  onMouseDown={() => activateRoom(room.id)}
                  onTap={() => activateRoom(room.id)}
                  ref={(node) => bindGroupRef(room.id, node)}
                  x={roomX}
                  y={roomY}
                >
                  <Rect
                    ref={(node) => bindShapeRef(room.id, node)}
                    cornerRadius={4}
                    fill={isSelected ? "#fef3c7" : getRoomColor(room)}
                    height={roomHeightPx}
                    stroke={isOverlapping ? "#ef4444" : (isSelected ? "#b45309" : "#57534e")}
                    strokeWidth={isOverlapping ? 2 : (isSelected ? 1.5 : 1)}
                    width={roomWidthPx}
                    onTransformStart={() => setIsTransforming(true)}
                    onTransformEnd={(event) => {
                      const rectNode = event.target;
                      const groupNode = rectNode.parent;
                      
                      const newWidth = room.width * rectNode.scaleX();
                      const newHeight = room.height * rectNode.scaleY();
                      const newX = groupNode.x() / pixelsPerPlotUnitX + rectNode.x() / pixelsPerPlotUnitX;
                      const newY = groupNode.y() / pixelsPerPlotUnitY + rectNode.y() / pixelsPerPlotUnitY;

                      const nextWidth = clamp(snapToGrid(newWidth), MIN_ROOM_SIZE, plotWidth);
                      const nextHeight = clamp(snapToGrid(newHeight), MIN_ROOM_SIZE, plotHeight);
                      const nextX = clamp(snapToGrid(newX), 0, Math.max(0, plotWidth - nextWidth));
                      const nextY = clamp(snapToGrid(newY), 0, Math.max(0, plotHeight - nextHeight));

                      updateRoom(room.id, {
                        x: nextX,
                        y: nextY,
                        width: nextWidth,
                        height: nextHeight,
                      });

                      // Reset local transform
                      rectNode.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
                      setIsTransforming(false);
                    }}
                  />
                  
                  {isOverlapping && (
                    <Text
                      x={roomWidthPx / 2 - 30} y={roomHeightPx - 15}
                      text="⚠️ Overlapping"
                      fill="#ef4444"
                      fontSize={Math.max(8, dimensionFontSize * 0.8)}
                      fontStyle="bold"
                      listening={false}
                    />
                  )}
                  {!(isTransforming && isSelected) && (
                    <Group>
                      <Text
                        align="center"
                        fontFamily="sans-serif"
                        fontSize={labelFontSize}
                        fontStyle="bold"
                        height={labelTextHeight}
                        listening={false}
                        padding={4}
                        text={room.label}
                        verticalAlign="middle"
                        width={roomWidthPx}
                        y={labelY}
                      />
                      <Text
                    align="center"
                    fill="#57534e"
                    fontFamily="sans-serif"
                    fontSize={dimensionFontSize}
                    height={dimensionTextHeight}
                    listening={false}
                    padding={2}
                    text={`${Math.round(room.width)} × ${Math.round(room.height)} ft`}
                    verticalAlign="middle"
                    width={roomWidthPx}
                    y={dimensionY}
                  />

                  {/* ── Ventilation Warning ── */}
                  {(() => {
                    if (room.type === "Kitchen" || room.type?.includes("Bath")) {
                      const hasWindows = (room.windows || []).length > 0;
                      if (!hasWindows) {
                        const ventWalls = getVentilationWalls(room, rooms, plotWidth, plotHeight, boundaries);
                        if (ventWalls.length === 0) {
                          return (
                            <Text
                              text="⚠️"
                              fontSize={dimensionFontSize * 1.5}
                              x={roomWidthPx - (dimensionFontSize * 1.5) - 4}
                              y={4}
                              listening={false}
                            />
                          );
                        }
                      }
                    }
                    return null;
                  })()}

                  {/* ── Ghost Furniture ── */}
                  {showFurniture && GHOST_FURNITURE[room.type] && (
                    <Group listening={false} opacity={0.6}>
                      {GHOST_FURNITURE[room.type].map((item, i) => {
                        const pos = computeFurniturePosition(item, room, pixelsPerPlotUnitX, pixelsPerPlotUnitY);
                        return (
                          <Group key={i}>
                            {item.type === "bed" ? (
                              <>
                                <Rect
                                  x={pos.x} y={pos.y}
                                  width={pos.w} height={pos.h}
                                  stroke="#6b7280" strokeWidth={1}
                                  fill="rgba(243, 244, 246, 0.4)" cornerRadius={4}
                                />
                                <Rect
                                  x={pos.x} y={pos.y}
                                  width={pos.w} height={pos.h * 0.15}
                                  fill="rgba(156, 163, 175, 0.4)" cornerRadius={2}
                                />
                              </>
                            ) : item.type === "l-sofa" ? (
                              <>
                                <Rect
                                  x={pos.x} y={pos.y}
                                  width={pos.w} height={pos.h * 0.4}
                                  stroke="#6b7280" strokeWidth={1}
                                  fill="rgba(243, 244, 246, 0.4)" cornerRadius={4}
                                />
                                <Rect
                                  x={pos.x} y={pos.y}
                                  width={pos.w * 0.4} height={pos.h}
                                  stroke="#6b7280" strokeWidth={1}
                                  fill="rgba(243, 244, 246, 0.4)" cornerRadius={4}
                                />
                              </>
                            ) : item.type === "l-counter" ? (
                              <>
                                <Rect
                                  x={pos.x} y={pos.y + pos.h - (2 * pixelsPerPlotUnitY)}
                                  width={pos.w} height={2 * pixelsPerPlotUnitY}
                                  fill="rgba(209, 213, 219, 0.5)" stroke="#9ca3af" strokeWidth={1}
                                />
                                <Rect
                                  x={pos.x} y={pos.y}
                                  width={2 * pixelsPerPlotUnitX} height={pos.h}
                                  fill="rgba(209, 213, 219, 0.5)" stroke="#9ca3af" strokeWidth={1}
                                />
                              </>
                            ) : (
                              <Rect
                                x={pos.x} y={pos.y}
                                width={pos.w} height={pos.h}
                                stroke="#6b7280"
                                strokeWidth={1}
                                fill="rgba(243, 244, 246, 0.4)"
                                cornerRadius={3}
                              />
                            )}
                            {item.type !== "l-counter" && (
                              <Text
                                x={pos.x} y={pos.y}
                                width={pos.w} height={pos.h}
                                text={item.label}
                                align="center"
                                verticalAlign="middle"
                                fontSize={Math.max(7, Math.min(10, roomWidthPx * 0.05))}
                                fill="#4b5563"
                                fontFamily="sans-serif"
                              />
                            )}
                          </Group>
                        );
                      })}
                    </Group>
                  )}

                  {/* ── Doors ── */}
                  {(room.doors || []).map((door) => {
                    const rect = getElementPixelRect(door, room, plotWidth, plotHeight, stageWidth, stageHeight, DOOR_DEPTH_FT);
                    return (
                      <Group key={door.id}>
                        <Rect
                          x={rect.x}
                          y={rect.y}
                          width={rect.w}
                          height={rect.h}
                          fill="#ffffff"
                          stroke="#b45309"
                          strokeWidth={1.5}
                          cornerRadius={1}
                          draggable
                          dragBoundFunc={(pos) => getElementDragBound(pos, door, room, DOOR_DEPTH_FT)}
                          onDragMove={(e) => handleElementDragMove(e, door, room, DOOR_DEPTH_FT)}
                          onDragEnd={(e) => {
                            handleElementDragEnd(e, door, room, updateDoorState);
                            // Reset local position (state drives rendering)
                            e.target.position({ x: rect.x, y: rect.y });
                          }}
                          onDblClick={() => removeDoor(room.id, door.id)}
                          onDblTap={() => removeDoor(room.id, door.id)}
                        />
                        {/* Door swing arc indicator */}
                        {(() => {
                          const arcRadius = Math.min(rect.w, rect.h) * 1.5;
                          let arcX = rect.x, arcY = rect.y, rotation = 0;
                          if (door.wall === "bottom") {
                            arcX = rect.x; arcY = rect.y; rotation = -90;
                          } else if (door.wall === "top") {
                            arcX = rect.x + rect.w; arcY = rect.y + rect.h; rotation = 90;
                          } else if (door.wall === "left") {
                            arcX = rect.x + rect.w; arcY = rect.y; rotation = 0;
                          } else if (door.wall === "right") {
                            arcX = rect.x; arcY = rect.y + rect.h; rotation = 180;
                          }
                          return (
                            <Arc
                              x={arcX}
                              y={arcY}
                              innerRadius={0}
                              outerRadius={arcRadius}
                              angle={90}
                              rotation={rotation}
                              fill="rgba(180,83,9,0.08)"
                              stroke="#b45309"
                              strokeWidth={0.5}
                              dash={[2, 2]}
                              listening={false}
                            />
                          );
                        })()}
                      </Group>
                    );
                  })}

                  {/* ── Windows ── */}
                  {(room.windows || []).map((win) => {
                    const rect = getElementPixelRect(win, room, plotWidth, plotHeight, stageWidth, stageHeight, WINDOW_DEPTH_FT);
                    const isHorizontal = win.wall === "top" || win.wall === "bottom";
                    return (
                      <Group key={win.id}>
                        <Rect
                          x={rect.x}
                          y={rect.y}
                          width={rect.w}
                          height={rect.h}
                          fill="#dbeafe"
                          stroke="#2563eb"
                          strokeWidth={1.2}
                          draggable
                          dragBoundFunc={(pos) => getElementDragBound(pos, win, room, WINDOW_DEPTH_FT)}
                          onDragMove={(e) => handleElementDragMove(e, win, room, WINDOW_DEPTH_FT)}
                          onDragEnd={(e) => {
                            handleElementDragEnd(e, win, room, updateWindowState);
                            e.target.position({ x: rect.x, y: rect.y });
                          }}
                          onDblClick={() => removeWindow(room.id, win.id)}
                          onDblTap={() => removeWindow(room.id, win.id)}
                        />
                        {/* Window pane lines */}
                        {isHorizontal ? (
                          <Line
                            points={[rect.x + rect.w / 2, rect.y, rect.x + rect.w / 2, rect.y + rect.h]}
                            stroke="#2563eb"
                            strokeWidth={0.8}
                            listening={false}
                          />
                        ) : (
                          <Line
                            points={[rect.x, rect.y + rect.h / 2, rect.x + rect.w, rect.y + rect.h / 2]}
                            stroke="#2563eb"
                            strokeWidth={0.8}
                            listening={false}
                          />
                        )}
                      </Group>
                    );
                  })}
                  </Group>
                )}
                </Group>
              );
            })}
          </Layer>

          {/* Compass indicator layer */}
          <Layer listening={false}>
            <CompassIndicator frontDirection={frontDirection} stageWidth={stageWidth} />
          </Layer>

          {/* Dedicated top layer for the Transformer so its handles are always
              above every room Group and can never be intercepted by them */}
          <Layer>
            <Transformer
              anchorDragBoundFunc={(_oldPosition, newPosition) => ({
                x: newPosition.x,
                y: newPosition.y,
              })}
              boundBoxFunc={(oldBox, newBox) => ({
                x: newBox.x,
                y: newBox.y,
                width: Math.max(
                  MIN_ROOM_SIZE * pixelsPerPlotUnitX,
                  newBox.width,
                ),
                height: Math.max(
                  MIN_ROOM_SIZE * pixelsPerPlotUnitY,
                  newBox.height,
                ),
                rotation: oldBox.rotation,
              })}
              flipEnabled={false}
              keepRatio={false}
              padding={8}
              ref={transformerRef}
              rotateEnabled={false}
            />
          </Layer>
        </Stage>
      </div>

      {/* ── Room Selection Panel ── */}
      {selectedRoom && (
        <div className="room-actions-panel">
          <div className="room-actions-header">
            <span className="room-actions-title">{selectedRoom.label}</span>
            <span className="room-actions-dims">
              {Math.round(selectedRoom.width)} × {Math.round(selectedRoom.height)} ft
            </span>
          </div>
          <div className="room-actions-buttons">
            <button
              className="room-action-btn door-btn"
              onClick={addDoorToRoom}
              title="Add a door to this room"
            >
              🚪 Add Door
            </button>
            <button
              className="room-action-btn window-btn"
              onClick={addWindowToRoom}
              title="Add a window to this room (external walls only)"
            >
              🪟 Add Window
            </button>
            {selectedId !== "hall" && (
              <button
                className="room-action-btn delete-btn"
                onClick={deleteSelectedRoom}
                title="Delete this room"
              >
                🗑 Delete
              </button>
            )}
          </div>
          {/* List existing doors & windows for this room */}
          {((selectedRoom.doors?.length || 0) + (selectedRoom.windows?.length || 0)) > 0 && (
            <div className="room-elements-list">
              {(selectedRoom.doors || []).map((door) => (
                <span className="room-element-tag door-tag" key={door.id}>
                  🚪 {door.wall}
                  <button className="remove-element-btn" onClick={() => removeDoor(selectedRoom.id, door.id)} title="Remove door">×</button>
                </span>
              ))}
              {(selectedRoom.windows || []).map((win) => (
                <span className="room-element-tag window-tag" key={win.id}>
                  🪟 {win.wall}
                  <button className="remove-element-btn" onClick={() => removeWindow(selectedRoom.id, win.id)} title="Remove window">×</button>
                </span>
              ))}
            </div>
          )}
          <p className="room-actions-hint">Double-click a door/window on canvas to remove it. Drag to reposition along wall.</p>
        </div>
      )}

      {/* ── Add Room Toolbar ── */}
      <div className="add-room-toolbar">
        <div className="toolbar-header">
          <span className="toolbar-title">Add Room</span>
          <button
            className={`copy-schema-btn ${copyFeedback ? "success" : ""}`}
            onClick={handleCopySchema}
            disabled={!!copyFeedback}
          >
            {copyFeedback || "📋 Copy Layout Schema"}
          </button>
        </div>
        {filteredCatalog.map((category) => (
          <div className="toolbar-category" key={category.category}>
            <span className="toolbar-category-label">{category.category}</span>
            <div className="toolbar-buttons">
              {category.rooms.map((entry) => (
                <button
                  className="add-room-btn"
                  key={entry.type}
                  onClick={() => addRoom(entry.type, entry.defaultW, entry.defaultH)}
                  title={`Add ${entry.type} (${entry.defaultW}×${entry.defaultH} ft)`}
                >
                  {entry.type}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default GridFloorPlanEditor;
