import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Text, Transformer } from "react-konva";

const BASE_GRID_CELLS = 256;
const CELLS_PER_FOOT = 4;
const GRID_SIZE = 0.25;
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

function placeFurniture(room) {
  const items = [];
  const minDim = Math.min(room.width, room.height);
  const area = room.width * room.height;
  const isHoriz = room.width >= room.height;

  const collides = (a, b, padding = 0.15) => (
    a.x < b.x + b.w - padding &&
    a.x + a.w > b.x + padding &&
    a.y < b.y + b.h - padding &&
    a.y + a.h > b.y + padding
  );

  const pushItem = (item) => {
    if (!item || !Number.isFinite(item.w) || !Number.isFinite(item.h)) return null;

    const margin = 0.2;
    const maxW = Math.max(0.4, room.width - margin * 2);
    const maxH = Math.max(0.4, room.height - margin * 2);
    const nextW = clamp(item.w, 0.4, maxW);
    const nextH = clamp(item.h, 0.4, maxH);
    const nextX = clamp(item.x, margin, Math.max(margin, room.width - nextW - margin));
    const nextY = clamp(item.y, margin, Math.max(margin, room.height - nextH - margin));

    const normalized = {
      ...item,
      w: nextW,
      h: nextH,
      x: nextX,
      y: nextY,
    };

    items.push(normalized);
    return normalized;
  };

  if (room.type.toLowerCase().includes("bed") || room.type === "Guest Room") {
    let bedW, bedH;
    if (minDim < 10) { bedW = 3; bedH = 6.5; }
    else if (minDim < 14) { bedW = 5; bedH = 6.5; }
    else { bedW = 6.5; bedH = 6.5; }

    const isKing = bedW === 6.5;
    const typeLabel = isKing ? "king-bed" : (bedW === 5 ? "queen-bed" : "single-bed");

    let bedX = (room.width - bedW) / 2;
    let bedY = 0.5; // Offset slightly from wall
    
    // Attempt basic door avoidance on top wall
    const topHasDoor = (room.doors || []).some(d => d.wall === "top");
    if (topHasDoor) {
      if (isHoriz) {
        bedX = room.width - 6.5 - 0.5;
        bedY = (room.height - bedW) / 2;
        pushItem({ type: typeLabel, w: 6.5, h: bedW, x: bedX, y: bedY, rot: 90 });
        if (isKing) {
          pushItem({ type: "side-table", w: 1.5, h: 1.5, x: bedX + 6.5 - 1.5, y: bedY - 1.5 - 0.5 });
          pushItem({ type: "side-table", w: 1.5, h: 1.5, x: bedX + 6.5 - 1.5, y: bedY + bedW + 0.5 });
        }
      } else {
        bedY = room.height - 6.5 - 0.5;
        pushItem({ type: typeLabel, w: bedW, h: 6.5, x: bedX, y: bedY, rot: 180 });
        if (isKing) {
          pushItem({ type: "side-table", w: 1.5, h: 1.5, x: bedX - 1.5 - 0.5, y: bedY });
          pushItem({ type: "side-table", w: 1.5, h: 1.5, x: bedX + bedW + 0.5, y: bedY });
        }
      }
    } else {
      pushItem({ type: typeLabel, w: bedW, h: 6.5, x: bedX, y: bedY, rot: 0 });
      if (isKing) {
        pushItem({ type: "side-table", w: 1.5, h: 1.5, x: bedX - 1.5 - 0.5, y: bedY });
        pushItem({ type: "side-table", w: 1.5, h: 1.5, x: bedX + bedW + 0.5, y: bedY });
      }
    }

    if (room.width >= 9 && room.height >= 10) {
      const wardrobeW = Math.min(5.6, room.width - 1.4);
      pushItem({
        type: "wardrobe",
        w: wardrobeW,
        h: 1.8,
        x: (room.width - wardrobeW) / 2,
        y: room.height - 2.3,
      });
    }

    if (room.width >= 10 && room.height >= 11) {
      pushItem({
        type: "study-table",
        w: 3.2,
        h: 1.5,
        x: 0.7,
        y: room.height - 2.1,
      });
    }
  } 
  else if (room.type === "Hall" || room.type === "Living") {
    if (area < 150) {
      const sofa = { type: "2-seater", w: 5, h: 3, x: (room.width - 5) / 2, y: room.height - 4 };
      const table = { type: "center-table", w: 3, h: 1.6, x: (room.width - 3) / 2, y: sofa.y - 2.2 };
      const tv = { type: "tv-unit", w: 4.5, h: 1.3, x: (room.width - 4.5) / 2, y: 0.5 };

      pushItem(sofa);
      if (room.width >= 10 && room.height >= 9) {
        pushItem(table);
      }
      if (room.width >= 8) {
        pushItem(tv);
      }
    } else if (area < 250) {
      const sofa = { type: "3-seater", w: 7, h: 3, x: (room.width - 7) / 2, y: room.height - 4 };
      const table = { type: "coffee-table", w: 4, h: 2, x: (room.width - 4) / 2, y: sofa.y - 2.6 };
      const tv = { type: "tv-unit", w: 5.5, h: 1.4, x: (room.width - 5.5) / 2, y: 0.5 };
      const dining = { type: "dining-4", w: 3.4, h: 3.4, x: 0.8, y: 0.8 };

      if (room.width >= 12 && room.height >= 11 && collides(dining, tv)) {
        tv.x = room.width - tv.w - 0.8;
      }

      pushItem(sofa);
      pushItem(table);
      pushItem(tv);
      if (room.width >= 12 && room.height >= 11) {
        pushItem(dining);
      }
    } else {
      const sofa = { type: "l-shape-sofa", w: 8, h: 6, x: room.width - 9, y: room.height - 7, rot: 0 };
      const tv = { type: "tv-unit", w: 6, h: 1.5, x: room.width - 7, y: 0.5 };
      const table = {
        type: "center-table",
        w: 3.8,
        h: 2.1,
        x: sofa.x + (sofa.w - 3.8) / 2,
        y: sofa.y - 2.9,
      };
      const dining = { type: "dining-6", w: 5.3, h: 3.3, x: 1, y: 1.2 };

      if (collides(dining, tv)) {
        dining.y = tv.y + tv.h + 0.8;
      }
      if (collides(dining, sofa)) {
        dining.y = Math.max(0.8, sofa.y - dining.h - 0.8);
      }

      pushItem(sofa);
      pushItem(tv);
      pushItem(table);
      if (room.width >= 14 && room.height >= 12) {
        pushItem(dining);
      }
    }
  }
  else if (room.type === "Kitchen") {
    const hasLeftDoor = (room.doors || []).some(d => d.wall === "left");
    if (!hasLeftDoor) {
      pushItem({ type: "kitchen-counter", w: 2, h: room.height - 1, x: 0.5, y: 0.5 });
      if (room.width >= 4.8) {
        pushItem({ type: "fridge", w: 2, h: 2.2, x: room.width - 2.5, y: 0.6 });
      }
    } else {
      pushItem({ type: "kitchen-counter", w: room.width - 1, h: 2, x: 0.5, y: 0.5 });
      if (room.height >= 4.8) {
        pushItem({ type: "fridge", w: 2.2, h: 2, x: 0.6, y: room.height - 2.5 });
      }
    }
  }
  else if (room.type.includes("Dining") || room.type === "Dining") {
    if (area < 100) pushItem({ type: "dining-4", w: 3, h: 3, x: (room.width - 3)/2, y: (room.height - 3)/2 });
    else if (area < 150) pushItem({ type: "dining-6", w: 5, h: 3, x: (room.width - 5)/2, y: (room.height - 3)/2 });
    else pushItem({ type: "dining-8", w: 7, h: 3, x: (room.width - 7)/2, y: (room.height - 3)/2 });
  }
  else if (room.type.includes("Bath") || room.type.includes("Toilet")) {
    if (room.width >= 5 && room.height >= 5) {
      const tubW = Math.min(room.width - 1, 4.6);
      const tubH = Math.min(room.height - 1, 2.4);
      pushItem({ type: "bathtub", w: tubW, h: tubH, x: (room.width - tubW) / 2, y: 0.5 });
    } else if (room.width >= 4 && room.height >= 4) {
      pushItem({ type: "shower-area", w: Math.min(2.8, room.width - 0.8), h: 2.2, x: 0.4, y: 0.4 });
    }

    if (room.width >= 3.2 && room.height >= 3.6) {
      pushItem({ type: "sink", w: 1.6, h: 1.1, x: room.width - 2.0, y: room.height - 1.5 });
    }

    if (room.width >= 3.4 && room.height >= 4.2) {
      pushItem({ type: "toilet-seat", w: 1.5, h: 2, x: 0.4, y: room.height - 2.4 });
    }
  }
  else if (room.type === "Parking") {
    if (room.width >= 9 && room.height >= 6) {
      const carW = Math.min(room.width - 1.2, 8);
      const carH = Math.min(room.height - 1.2, 4.2);
      pushItem({ type: "car", w: carW, h: carH, x: (room.width - carW) / 2, y: (room.height - carH) / 2 });
    }
  }
  else if (room.type === "Front Yard" || room.type === "Courtyard") {
    if (room.width >= 5 && room.height >= 4) {
      const pathW = Math.min(2.2, room.width - 1);
      pushItem({ type: "pathway", w: pathW, h: room.height - 0.8, x: (room.width - pathW) / 2, y: 0.4 });
      pushItem({ type: "planter", w: 1.1, h: 1.1, x: 0.4, y: 0.4 });
      pushItem({ type: "planter", w: 1.1, h: 1.1, x: room.width - 1.5, y: 0.4 });
    }
    if (room.width >= 7 && room.height >= 5) {
      pushItem({ type: "outdoor-bench", w: 3.2, h: 1.1, x: 0.5, y: room.height - 1.6 });
      pushItem({ type: "planter", w: 1.2, h: 1.2, x: room.width - 1.6, y: room.height - 1.6 });
    }
  }
  else if (room.type === "Entrance Porch" || room.type === "Entry Lobby") {
    if (room.width >= 4.5 && room.height >= 3.5) {
      pushItem({ type: "outdoor-bench", w: Math.min(3.6, room.width - 1), h: 1, x: 0.5, y: room.height - 1.4 });
      pushItem({ type: "shoe-rack", w: Math.min(2.4, room.width - 1), h: 0.9, x: room.width - Math.min(2.4, room.width - 1) - 0.5, y: room.height - 1.3 });
      pushItem({ type: "planter", w: 1, h: 1, x: 0.5, y: 0.5 });
    }
  }
  else if (room.type === "Laundry" || room.type === "Back Utility") {
    if (room.width >= 4.5 && room.height >= 3.5) {
      pushItem({ type: "washing-machine", w: 2.2, h: 2.2, x: 0.5, y: 0.5 });
      pushItem({ type: "sink", w: 1.6, h: 1.1, x: room.width - 2.1, y: 0.6 });
    }
  }

  return items;
}

function FurniturePiece({ item, pxX, pxY }) {
  const x = item.x * pxX;
  const y = item.y * pxY;
  const w = item.w * pxX;
  const h = item.h * pxY;
  const strokeColor = "#111827";
  const bg = "#f3f4f6";

  if (item.type.includes("bed")) {
    const isRot = item.rot === 90;
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill={bg} stroke={strokeColor} strokeWidth={1} />
        {item.rot === 0 || item.rot === 180 ? (
          <Line points={[0, h * 0.3, w, h * 0.3]} stroke={strokeColor} strokeWidth={1} />
        ) : (
          <Line points={[w * 0.3, 0, w * 0.3, h]} stroke={strokeColor} strokeWidth={1} />
        )}
        {item.type !== "single-bed" ? (
          <>
            <Rect x={w*0.1} y={h*0.05} width={isRot?w*0.15:w*0.3} height={isRot?h*0.3:h*0.15} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} />
            <Rect x={isRot?w*0.1:w*0.6} y={isRot?h*0.6:h*0.05} width={isRot?w*0.15:w*0.3} height={isRot?h*0.3:h*0.15} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} />
          </>
        ) : (
          <Rect x={w*0.25} y={h*0.05} width={w*0.5} height={h*0.15} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} />
        )}
      </Group>
    );
  } else if (item.type.includes("seater") || item.type === "l-shape-sofa") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill={bg} stroke={strokeColor} strokeWidth={1} cornerRadius={4} />
        {item.type === "l-shape-sofa" ? (
          <Rect x={w*0.3} y={0} width={w*0.7} height={h*0.7} fill="white" />
        ) : (
          <Rect x={w*0.1} y={h*0.1} width={w*0.8} height={h*0.8} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={2} />
        )}
        {item.type === "l-shape-sofa" && (
           <Line points={[w*0.3, 0, w*0.3, h*0.7, w, h*0.7]} stroke={strokeColor} strokeWidth={1} />
        )}
      </Group>
    );
  } else if (item.type.includes("dining")) {
    const is4 = item.type.includes("4");
    const is6 = item.type.includes("6");
    const is8 = item.type.includes("8");
    const chairR = Math.min(w, h) * 0.15;
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={2} />
        {(is6 || is8) && <Circle x={w*0.3} y={0} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
        {(is6 || is8) && <Circle x={w*0.7} y={0} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
        {is4 && <Circle x={w/2} y={0} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
        {(is6 || is8) && <Circle x={w*0.3} y={h} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
        {(is6 || is8) && <Circle x={w*0.7} y={h} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
        {is4 && <Circle x={w/2} y={h} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
        {(is8 || is4) && <Circle x={0} y={h/2} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
        {(is8 || is4) && <Circle x={w} y={h/2} radius={chairR} fill={bg} stroke={strokeColor} strokeWidth={1} />}
      </Group>
    );
  } else if (item.type === "tv-unit") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={2} />
        <Rect x={w * 0.1} y={h * 0.15} width={w * 0.8} height={h * 0.5} fill="#d1d5db" stroke={strokeColor} strokeWidth={1} cornerRadius={1} />
        <Line points={[w * 0.5, h * 0.68, w * 0.5, h]} stroke={strokeColor} strokeWidth={1} />
      </Group>
    );
  } else if (item.type === "center-table" || item.type === "coffee-table" || item.type === "vanity-table") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={Math.min(4, h * 0.25)} />
        <Line points={[w * 0.15, h * 0.5, w * 0.85, h * 0.5]} stroke={strokeColor} strokeWidth={1} opacity={0.55} />
      </Group>
    );
  } else if (item.type === "study-table" || item.type === "outdoor-bench" || item.type === "shoe-rack") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={Math.min(3, h * 0.28)} />
        <Line points={[w * 0.1, h * 0.28, w * 0.9, h * 0.28]} stroke={strokeColor} strokeWidth={1} opacity={0.55} />
      </Group>
    );
  } else if (item.type === "wardrobe") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={2} />
        <Line points={[w * 0.5, 0, w * 0.5, h]} stroke={strokeColor} strokeWidth={1} />
        <Circle x={w * 0.44} y={h * 0.52} radius={Math.max(1, Math.min(w, h) * 0.06)} fill="#9ca3af" />
        <Circle x={w * 0.56} y={h * 0.52} radius={Math.max(1, Math.min(w, h) * 0.06)} fill="#9ca3af" />
      </Group>
    );
  } else if (item.type === "sink") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={Math.min(5, h * 0.38)} />
        <Circle x={w * 0.5} y={h * 0.58} radius={Math.max(1.2, Math.min(w, h) * 0.12)} fill="#cbd5e1" stroke={strokeColor} strokeWidth={0.8} />
      </Group>
    );
  } else if (item.type === "toilet-seat") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h * 0.26} fill="#d1d5db" stroke={strokeColor} strokeWidth={1} cornerRadius={2} />
        <Rect x={w * 0.1} y={h * 0.2} width={w * 0.8} height={h * 0.72} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={Math.min(6, h * 0.4)} />
        <Rect x={w * 0.28} y={h * 0.4} width={w * 0.44} height={h * 0.36} fill="#f8fafc" stroke={strokeColor} strokeWidth={0.8} cornerRadius={Math.min(5, h * 0.2)} />
      </Group>
    );
  } else if (item.type === "shower-area" || item.type === "pathway") {
    return (
      <Group x={x} y={y}>
        <Rect
          width={w}
          height={h}
          fill={item.type === "pathway" ? "#d6d3d1" : "#f1f5f9"}
          stroke={strokeColor}
          strokeWidth={1}
          cornerRadius={2}
        />
        <Line points={[w * 0.12, h * 0.2, w * 0.88, h * 0.8]} stroke={strokeColor} strokeWidth={0.8} opacity={0.5} />
        <Line points={[w * 0.88, h * 0.2, w * 0.12, h * 0.8]} stroke={strokeColor} strokeWidth={0.8} opacity={0.5} />
      </Group>
    );
  } else if (item.type === "planter") {
    return (
      <Group x={x} y={y}>
        <Circle x={w * 0.5} y={h * 0.42} radius={Math.min(w, h) * 0.34} fill="#86a98a" stroke={strokeColor} strokeWidth={0.9} />
        <Rect x={w * 0.2} y={h * 0.66} width={w * 0.6} height={h * 0.24} fill="#d6d3d1" stroke={strokeColor} strokeWidth={0.9} cornerRadius={2} />
      </Group>
    );
  } else if (item.type === "washing-machine") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={2} />
        <Circle x={w * 0.5} y={h * 0.55} radius={Math.min(w, h) * 0.24} fill="#f8fafc" stroke={strokeColor} strokeWidth={0.9} />
        <Rect x={w * 0.12} y={h * 0.1} width={w * 0.76} height={h * 0.16} fill="#cbd5e1" stroke={strokeColor} strokeWidth={0.8} cornerRadius={1} />
      </Group>
    );
  } else if (item.type === "fridge") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={2} />
        <Line points={[0, h * 0.52, w, h * 0.52]} stroke={strokeColor} strokeWidth={1} />
        <Line points={[w * 0.74, h * 0.15, w * 0.74, h * 0.44]} stroke={strokeColor} strokeWidth={1} />
        <Line points={[w * 0.26, h * 0.62, w * 0.26, h * 0.9]} stroke={strokeColor} strokeWidth={1} />
      </Group>
    );
  } else if (item.type === "bathtub") {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={Math.min(h * 0.45, 8)} />
        <Rect x={w * 0.12} y={h * 0.2} width={w * 0.76} height={h * 0.6} fill="#f8fafc" stroke={strokeColor} strokeWidth={0.9} cornerRadius={Math.min(h * 0.34, 6)} />
        <Circle x={w * 0.82} y={h * 0.5} radius={Math.min(w, h) * 0.08} fill="#cbd5e1" stroke={strokeColor} strokeWidth={0.8} />
      </Group>
    );
  } else if (item.type === "car") {
    const wheelRadius = Math.max(2.2, Math.min(w, h) * 0.12);
    return (
      <Group x={x} y={y}>
        <Rect x={w * 0.08} y={h * 0.2} width={w * 0.84} height={h * 0.52} fill="#e5e7eb" stroke={strokeColor} strokeWidth={1} cornerRadius={Math.min(8, h * 0.22)} />
        <Rect x={w * 0.26} y={h * 0.28} width={w * 0.48} height={h * 0.26} fill="#cbd5e1" stroke={strokeColor} strokeWidth={0.9} cornerRadius={Math.min(6, h * 0.16)} />
        <Circle x={w * 0.24} y={h * 0.8} radius={wheelRadius} fill="#f8fafc" stroke={strokeColor} strokeWidth={1} />
        <Circle x={w * 0.76} y={h * 0.8} radius={wheelRadius} fill="#f8fafc" stroke={strokeColor} strokeWidth={1} />
      </Group>
    );
  } else {
    return (
      <Group x={x} y={y}>
        <Rect width={w} height={h} fill={bg} stroke={strokeColor} strokeWidth={1} />
      </Group>
    );
  }
}

function getRoomColor(room) {
  if (room.type === "Kitchen" || room?.type?.includes("Bath") || room?.roomType?.includes("Bath")) {
    return "#f8fafc";
  }
  return "#ffffff";
}

function toTitleCase(value) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPlotSize(value) {
  const feet = Math.floor(value);
  const inches = Math.round((value - feet) * 12);

  if (inches === 0) return `${feet} ft`;
  return `${feet} ft ${inches} in`;
}

function formatFeet(value) {
  return `${Number(value).toFixed(1)} ft`;
}

function fitTextToWidth(text, maxWidthPx, fontSize) {
  if (!text) return "";
  const approxCharWidth = Math.max(5, fontSize * 0.62);
  const maxChars = Math.max(3, Math.floor(maxWidthPx / approxCharWidth));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function detectTexture(roomType) {
  if (!roomType) return "none";

  if (
    roomType.includes("Hall") ||
    roomType.includes("Living") ||
    roomType.includes("Dining") ||
    roomType.includes("Kitchen")
  ) {
    return "planks";
  }

  if (roomType.includes("Bath") || roomType.includes("Toilet") || roomType.includes("Shaft")) {
    return "tiles";
  }

  if (roomType.includes("Bedroom") || roomType.includes("Guest")) {
    return "carpet";
  }

  if (
    roomType.includes("Yard") ||
    roomType.includes("Balcony") ||
    roomType.includes("Courtyard") ||
    roomType.includes("Utility")
  ) {
    return "garden";
  }

  return "none";
}

function roomTextureLines(texture, roomWidthPx, roomHeightPx) {
  if (texture === "none") return null;

  if (texture === "planks") {
    const gap = Math.max(9, Math.round(roomHeightPx / 11));
    const lines = [];
    for (let y = gap; y < roomHeightPx; y += gap) {
      lines.push(
        <Line
          key={`plank-${y}`}
          listening={false}
          points={[0, y, roomWidthPx, y]}
          stroke="rgba(122, 124, 111, 0.28)"
          strokeWidth={0.85}
          opacity={0.6}
        />,
      );
    }
    return lines;
  }

  if (texture === "tiles") {
    const step = Math.max(12, Math.round(Math.min(roomWidthPx, roomHeightPx) / 5));
    const lines = [];

    for (let x = step; x < roomWidthPx; x += step) {
      lines.push(
        <Line
          key={`tile-x-${x}`}
          listening={false}
          points={[x, 0, x, roomHeightPx]}
          stroke="rgba(178, 179, 165, 0.5)"
          strokeWidth={0.75}
          opacity={0.55}
        />,
      );
    }

    for (let y = step; y < roomHeightPx; y += step) {
      lines.push(
        <Line
          key={`tile-y-${y}`}
          listening={false}
          points={[0, y, roomWidthPx, y]}
          stroke="rgba(178, 179, 165, 0.5)"
          strokeWidth={0.75}
          opacity={0.55}
        />,
      );
    }

    return lines;
  }

  if (texture === "carpet") {
    const step = Math.max(14, Math.round(Math.min(roomWidthPx, roomHeightPx) / 6));
    const lines = [];
    for (let i = -roomHeightPx; i < roomWidthPx + roomHeightPx; i += step) {
      lines.push(
        <Line
          key={`carpet-${i}`}
          listening={false}
          points={[i, roomHeightPx, i + roomHeightPx, 0]}
          stroke="rgba(160, 151, 135, 0.32)"
          strokeWidth={0.7}
          opacity={0.5}
        />,
      );
    }
    return lines;
  }

  if (texture === "garden") {
    const step = Math.max(10, Math.round(Math.min(roomWidthPx, roomHeightPx) / 7));
    const lines = [];
    for (let i = -roomHeightPx; i < roomWidthPx + roomHeightPx; i += step) {
      lines.push(
        <Line
          key={`garden-a-${i}`}
          listening={false}
          points={[i, 0, i + roomHeightPx, roomHeightPx]}
          stroke="rgba(75, 101, 81, 0.22)"
          strokeWidth={0.7}
          opacity={0.32}
        />,
      );
      lines.push(
        <Line
          key={`garden-b-${i}`}
          listening={false}
          points={[i, roomHeightPx, i + roomHeightPx, 0]}
          stroke="rgba(75, 101, 81, 0.22)"
          strokeWidth={0.7}
          opacity={0.32}
        />,
      );
    }
    return lines;
  }

  return null;
}

function getRoomPresentationStyle(room, isPresentationMode, isSelected, isOverlapping, isDarkTheme) {
  const roomType = room.type || room.roomType || "";

  if (!isPresentationMode && !isDarkTheme) {
    let fill = "rgba(239, 238, 227, 0.88)";
    if (roomType.includes("Hall") || roomType.includes("Living") || roomType.includes("Dining")) fill = "rgba(202, 233, 231, 0.55)";
    else if (roomType.includes("Kitchen")) fill = "rgba(202, 233, 231, 0.46)";
    else if (roomType.includes("Bath") || roomType.includes("Toilet") || roomType.includes("Shaft")) fill = "rgba(227, 228, 212, 0.72)";
    else if (roomType.includes("Bedroom") || roomType.includes("Guest")) fill = "rgba(230, 226, 216, 0.82)";

    if (isSelected) fill = "rgba(188, 218, 217, 0.65)";
    if (isOverlapping) fill = "rgba(255, 116, 106, 0.3)";

    return {
      fill,
      wallStroke: isOverlapping ? "#9f403d" : (isSelected ? "#476362" : "#5e6054"),
      labelColor: isSelected ? "#284443" : "#313429",
      dimensionColor: "#5e6054",
      texture: "none",
    };
  }

  if (!isPresentationMode && isDarkTheme) {
    let fill = "rgba(40, 44, 46, 0.78)";
    if (roomType.includes("Hall") || roomType.includes("Living") || roomType.includes("Dining")) fill = "rgba(0, 229, 255, 0.12)";
    else if (roomType.includes("Kitchen")) fill = "rgba(0, 229, 255, 0.09)";
    else if (roomType.includes("Bath") || roomType.includes("Toilet") || roomType.includes("Shaft")) fill = "rgba(206, 214, 219, 0.15)";
    else if (roomType.includes("Bedroom") || roomType.includes("Guest")) fill = "rgba(94, 104, 110, 0.28)";

    if (isSelected) fill = "rgba(0, 229, 255, 0.2)";
    if (isOverlapping) fill = "rgba(255, 116, 106, 0.3)";

    return {
      fill,
      wallStroke: isOverlapping ? "#ff8a80" : (isSelected ? "#00e5ff" : "#c6d6da"),
      labelColor: isSelected ? "#c6fbff" : "#d9e4e7",
      dimensionColor: "#8ea6ad",
      texture: "none",
    };
  }

  if (isDarkTheme) {
    let fill = "rgba(34, 38, 39, 0.82)";
    if (roomType.includes("Hall") || roomType.includes("Living") || roomType.includes("Dining")) fill = "rgba(0, 229, 255, 0.15)";
    else if (roomType.includes("Kitchen")) fill = "rgba(0, 229, 255, 0.11)";
    else if (roomType.includes("Bath") || roomType.includes("Toilet") || roomType.includes("Shaft")) fill = "rgba(184, 200, 206, 0.2)";
    else if (roomType.includes("Bedroom") || roomType.includes("Guest")) fill = "rgba(93, 110, 116, 0.28)";
    else if (roomType.includes("Yard") || roomType.includes("Balcony") || roomType.includes("Courtyard")) fill = "rgba(88, 121, 126, 0.25)";
    else if (roomType.includes("Parking")) fill = "rgba(88, 95, 99, 0.32)";

    if (isSelected) fill = "rgba(0, 229, 255, 0.23)";
    if (isOverlapping) fill = "rgba(255, 116, 106, 0.35)";

    return {
      fill,
      wallStroke: isOverlapping ? "#ff8a80" : (isSelected ? "#00e5ff" : "#c6d6da"),
      labelColor: isSelected ? "#dcfbff" : "#d9e4e7",
      dimensionColor: "#8ea6ad",
      texture: detectTexture(roomType),
    };
  }

  let fill = "rgba(239, 238, 227, 0.92)";
  if (roomType.includes("Hall") || roomType.includes("Living") || roomType.includes("Dining")) fill = "rgba(215, 246, 220, 0.58)";
  else if (roomType.includes("Kitchen")) fill = "rgba(202, 233, 231, 0.55)";
  else if (roomType.includes("Bath") || roomType.includes("Toilet") || roomType.includes("Shaft")) fill = "rgba(227, 228, 212, 0.82)";
  else if (roomType.includes("Bedroom") || roomType.includes("Guest")) fill = "rgba(230, 226, 216, 0.86)";
  else if (roomType.includes("Yard") || roomType.includes("Balcony") || roomType.includes("Courtyard")) fill = "rgba(201, 231, 206, 0.62)";
  else if (roomType.includes("Parking")) fill = "rgba(227, 228, 212, 0.72)";

  if (isSelected) fill = "rgba(188, 218, 217, 0.72)";
  if (isOverlapping) fill = "rgba(255, 116, 106, 0.35)";

  return {
    fill,
    wallStroke: isOverlapping ? "#9f403d" : (isSelected ? "#476362" : "#5e6054"),
    labelColor: isSelected ? "#284443" : "#313429",
    dimensionColor: "#5e6054",
    texture: detectTexture(roomType),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function intervalsOverlap(startA, endA, startB, endB, tolerance = GRID_SIZE * 0.5) {
  return Math.min(endA, endB) - Math.max(startA, startB) > tolerance;
}

function roomsOverlap(a, b, overlapTolerance = 0.5) {
  return (
    a.x < b.x + b.width - overlapTolerance &&
    a.x + a.width > b.x + overlapTolerance &&
    a.y < b.y + b.height - overlapTolerance &&
    a.y + a.height > b.y + overlapTolerance
  );
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

  const usedIds = new Set();
  const toSafeString = (value) => String(value ?? "").trim();
  const makeUniqueRoomId = (candidateId, index) => {
    const baseId = toSafeString(candidateId) || `room-${index + 1}`;
    let nextId = baseId;
    let suffix = 2;

    while (usedIds.has(nextId)) {
      nextId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(nextId);
    return nextId;
  };

  return sortRoomsWithHallBase(
    initialRooms.map((room, index) => {
      const fallbackName = `Room ${index + 1}`;
      const normalizedType =
        toSafeString(room?.type) ||
        toSafeString(room?.roomType) ||
        toSafeString(room?.label) ||
        fallbackName;
      const normalizedRoomType =
        toSafeString(room?.roomType) ||
        toSafeString(room?.type) ||
        toSafeString(room?.label) ||
        fallbackName;
      const normalizedLabel =
        toSafeString(room?.label) ||
        toSafeString(room?.roomType) ||
        toSafeString(room?.type) ||
        fallbackName;

      return {
        id: makeUniqueRoomId(room?.id ?? room?.roomId ?? room?.type ?? room?.roomType, index),
        label: normalizedLabel,
        type: normalizedType,
        roomType: normalizedRoomType,
        x: Number(room?.x) || 0,
        y: Number(room?.y) || 0,
        width: Number(room?.width) || 0,
        height: Number(room?.height) || 0,
        doors: Array.isArray(room?.doors) ? room.doors : [],
        windows: Array.isArray(room?.windows) ? room.windows : [],
      };
    }),
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
function getDoorRenderingState(wall, state, x, y, w, h) {
  let arcX = x, arcY = y, rotation = 0;
  let panelPoints = [];
  const panelLen = (wall === "top" || wall === "bottom") ? w : h;
  
  if (wall === "bottom") {
    if (state === 0) { arcX = x; arcY = y + h/2; rotation = -90; panelPoints = [x, y + h/2, x, y + h/2 - panelLen]; }
    else if (state === 1) { arcX = x + w; arcY = y + h/2; rotation = 180; panelPoints = [x + w, y + h/2, x + w, y + h/2 - panelLen]; }
    else if (state === 2) { arcX = x; arcY = y + h/2; rotation = 0; panelPoints = [x, y + h/2, x, y + h/2 + panelLen]; }
    else if (state === 3) { arcX = x + w; arcY = y + h/2; rotation = 90; panelPoints = [x + w, y + h/2, x + w, y + h/2 + panelLen]; }
  } else if (wall === "top") {
    if (state === 0) { arcX = x; arcY = y + h/2; rotation = 0; panelPoints = [x, y + h/2, x, y + h/2 + panelLen]; }
    else if (state === 1) { arcX = x + w; arcY = y + h/2; rotation = 90; panelPoints = [x + w, y + h/2, x + w, y + h/2 + panelLen]; }
    else if (state === 2) { arcX = x; arcY = y + h/2; rotation = -90; panelPoints = [x, y + h/2, x, y + h/2 - panelLen]; }
    else if (state === 3) { arcX = x + w; arcY = y + h/2; rotation = 180; panelPoints = [x + w, y + h/2, x + w, y + h/2 - panelLen]; }
  } else if (wall === "left") {
    if (state === 0) { arcX = x + w/2; arcY = y; rotation = 0; panelPoints = [x + w/2, y, x + w/2 + panelLen, y]; }
    else if (state === 1) { arcX = x + w/2; arcY = y + h; rotation = -90; panelPoints = [x + w/2, y + h, x + w/2 + panelLen, y + h]; }
    else if (state === 2) { arcX = x + w/2; arcY = y; rotation = 90; panelPoints = [x + w/2, y, x + w/2 - panelLen, y]; }
    else if (state === 3) { arcX = x + w/2; arcY = y + h; rotation = 180; panelPoints = [x + w/2, y + h, x + w/2 - panelLen, y + h]; }
  } else if (wall === "right") {
    if (state === 0) { arcX = x + w/2; arcY = y; rotation = 90; panelPoints = [x + w/2, y, x + w/2 - panelLen, y]; }
    else if (state === 1) { arcX = x + w/2; arcY = y + h; rotation = 180; panelPoints = [x + w/2, y + h, x + w/2 - panelLen, y + h]; }
    else if (state === 2) { arcX = x + w/2; arcY = y; rotation = 0; panelPoints = [x + w/2, y, x + w/2 + panelLen, y]; }
    else if (state === 3) { arcX = x + w/2; arcY = y + h; rotation = -90; panelPoints = [x + w/2, y + h, x + w/2 + panelLen, y + h]; }
  }
  return { arcX, arcY, rotation, panelPoints, panelLen };
}

function getElementPixelRect(element, room, plotWidth, plotHeight, stageWidth, stageHeight, depthFt) {
  const pxPerUnitX = stageWidth / plotWidth;
  const pxPerUnitY = stageHeight / plotHeight;
  const widthPx = Math.round(element.width * pxPerUnitX);
  const depthPx = Math.round(depthFt * Math.max(pxPerUnitX, pxPerUnitY));
  const roomWPx = Math.round(room.width * pxPerUnitX);
  const roomHPx = Math.round(room.height * pxPerUnitY);

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




/* ── Compass component ── */
function CompassIndicator({ frontDirection, stageWidth, isDarkTheme, showFrontLabel = true }) {
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
        fill={isDarkTheme ? "rgba(32, 36, 37, 0.9)" : "rgba(251, 249, 242, 0.94)"}
        stroke={isDarkTheme ? "#7faeb8" : "#7a7c6f"}
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
        fill={isDarkTheme ? "#d6f3f8" : "#313429"}
        listening={false}
      />
      {/* Arrow line */}
      <Line
        points={[cx, cy, ax, ay]}
        stroke={isDarkTheme ? "#00e5ff" : "#476362"}
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
        fill={isDarkTheme ? "#d6f3f8" : "#313429"}
      />
      {showFrontLabel && (
        <Text
          x={cx - size / 2}
          y={cy + size / 2 + 2}
          width={size}
          text={`Front: ${frontDirection.charAt(0).toUpperCase() + frontDirection.slice(1)}`}
          fontSize={7}
          fontFamily="Inter, sans-serif"
          fill={isDarkTheme ? "#9ab8bf" : "#5e6054"}
          align="center"
          listening={false}
        />
      )}
    </Group>
  );
}

/* ── Plot Boundary Overlay ── */
function PlotBoundaryOverlay({ boundaries, stageWidth, stageHeight, isDarkTheme }) {
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
        let stroke = isDarkTheme ? "rgba(154, 184, 191, 0.45)" : "rgba(122, 124, 111, 0.45)";
        let strokeW = 4;
        let dash = [];

        if (status === "front") {
          stroke = isDarkTheme ? "#00e5ff" : "#476362";
          dash = [8, 4];
        } else if (status === "open") {
          stroke = isDarkTheme ? "#67f3ff" : "#4e6954";
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
  themeMode = "light",
  onRoomsChange,
}) {
  const isDarkTheme = themeMode === "dark";
  const [rooms, setRooms] = useState(() => normalizeIncomingRooms(initialRooms));
  const [selectedId, setSelectedId] = useState(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [draggingRoomId, setDraggingRoomId] = useState(null);
  const [showFurniture, setShowFurniture] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [stageWidth, setStageWidth] = useState(960);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [editorToast, setEditorToast] = useState("");
  const wrapperRef = useRef(null);
  const editorShellRef = useRef(null);
  const transformerRef = useRef(null);
  const groupRefs = useRef(new Map());
  const shapeRefs = useRef(new Map());
  const toastTimeoutRef = useRef(null);

  /* Counter for generating unique IDs when adding rooms manually */
  const addCounterRef = useRef(0);
  const doorCounterRef = useRef(0);
  const windowCounterRef = useRef(0);

  const grid = useMemo(
    () => normalizePlotGrid(plotWidth, plotHeight),
    [plotHeight, plotWidth],
  );

  const resolveDraggedRoomPosition = (movingRoom, rawX, rawY, currentRooms) => {
    const maxX = Math.max(0, plotWidth - movingRoom.width);
    const maxY = Math.max(0, plotHeight - movingRoom.height);
    const snapAndClampX = (value) => snapToGrid(clamp(value, 0, maxX));
    const snapAndClampY = (value) => snapToGrid(clamp(value, 0, maxY));

    let candidate = {
      x: snapAndClampX(rawX),
      y: snapAndClampY(rawY),
    };

    // Keep hall movement unconstrained by overlap checks, matching current UX rules.
    if (isHall(movingRoom)) {
      return candidate;
    }

    const otherRooms = currentRooms.filter((entry) => entry.id !== movingRoom.id && !isHall(entry));
    if (otherRooms.length === 0) {
      return candidate;
    }

    // If close enough to a neighbor wall, dock exactly edge-to-edge to remove tiny gaps.
    const EDGE_DOCK_THRESHOLD = GRID_SIZE;
    const xTargets = [];
    const yTargets = [];

    for (const other of otherRooms) {
      if (
        intervalsOverlap(
          candidate.y,
          candidate.y + movingRoom.height,
          other.y,
          other.y + other.height,
        )
      ) {
        xTargets.push(snapAndClampX(other.x - movingRoom.width));
        xTargets.push(snapAndClampX(other.x + other.width));
      }

      if (
        intervalsOverlap(
          candidate.x,
          candidate.x + movingRoom.width,
          other.x,
          other.x + other.width,
        )
      ) {
        yTargets.push(snapAndClampY(other.y - movingRoom.height));
        yTargets.push(snapAndClampY(other.y + other.height));
      }
    }

    const nearestDock = (value, targets, threshold) => {
      let nearest = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const target of targets) {
        const distance = Math.abs(target - value);
        if (distance <= threshold && distance < bestDistance) {
          nearest = target;
          bestDistance = distance;
        }
      }

      return nearest;
    };

    const dockedX = nearestDock(candidate.x, xTargets, EDGE_DOCK_THRESHOLD);
    if (dockedX !== null) {
      candidate.x = dockedX;
    }

    const dockedY = nearestDock(candidate.y, yTargets, EDGE_DOCK_THRESHOLD);
    if (dockedY !== null) {
      candidate.y = dockedY;
    }

    const candidateRoom = {
      x: candidate.x,
      y: candidate.y,
      width: movingRoom.width,
      height: movingRoom.height,
    };
    const hasOverlap = otherRooms.some((other) => roomsOverlap(candidateRoom, other));
    if (!hasOverlap) {
      return candidate;
    }

    // If overlap remains, move to the nearest non-overlapping edge-aligned slot.
    const positions = [];
    const seen = new Set();
    const pushPosition = (x, y) => {
      const nextX = snapAndClampX(x);
      const nextY = snapAndClampY(y);
      const key = `${nextX}|${nextY}`;
      if (seen.has(key)) return;
      seen.add(key);
      positions.push({ x: nextX, y: nextY });
    };

    pushPosition(candidate.x, candidate.y);

    for (const other of otherRooms) {
      const xEdges = [other.x - movingRoom.width, other.x + other.width];
      const yEdges = [other.y - movingRoom.height, other.y + other.height];

      for (const nextX of xEdges) {
        pushPosition(nextX, candidate.y);
      }

      for (const nextY of yEdges) {
        pushPosition(candidate.x, nextY);
      }

      for (const nextX of xEdges) {
        for (const nextY of yEdges) {
          pushPosition(nextX, nextY);
        }
      }
    }

    let bestPosition = candidate;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const position of positions) {
      const moved = {
        x: position.x,
        y: position.y,
        width: movingRoom.width,
        height: movingRoom.height,
      };
      const overlaps = otherRooms.some((other) => roomsOverlap(moved, other));
      if (overlaps) continue;

      const distance = Math.abs(position.x - candidate.x) + Math.abs(position.y - candidate.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = position;
      }
    }

    return bestPosition;
  };
  
    const updateRoom = (roomId, nextPartial) => {
      setRooms((currentRooms) =>
        currentRooms.map((room) => (room.id === roomId ? { ...room, ...nextPartial } : room)),
      );
    };
  
    const updateSelectedRoomLabel = (nextLabel) => {
      if (!selectedId) return;
      updateRoom(selectedId, { label: nextLabel });
    };

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

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleOutsideStagePointerDown = (event) => {
      if (editorShellRef.current && editorShellRef.current.contains(event.target)) {
        return;
      }

      const stageContainer = wrapperRef.current?.querySelector(".konvajs-content");
      if (!stageContainer) return;
      if (stageContainer.contains(event.target)) return;
      setSelectedId(null);
    };

    document.addEventListener("pointerdown", handleOutsideStagePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideStagePointerDown);
    };
  }, []);

  const stageHeight = Math.round(stageWidth * (plotHeight / plotWidth));
  const cellWidth = stageWidth / grid.columns;
  const cellHeight = stageHeight / grid.rows;
  const pixelsPerPlotUnitX = stageWidth / plotWidth;
  const pixelsPerPlotUnitY = stageHeight / plotHeight;

  const planSummary = useMemo(() => {
    const openSides = Object.entries(boundaries)
      .filter(([, status]) => status === "open")
      .map(([direction]) => toTitleCase(direction));
    const coveredSides = Object.entries(boundaries)
      .filter(([, status]) => status === "covered")
      .map(([direction]) => toTitleCase(direction));

    const bedrooms = rooms.filter((room) => (room.type || "").includes("Bedroom") || (room.type || "").includes("Guest")).length;
    const bathrooms = rooms.filter((room) => (room.type || "").includes("Bath") || (room.type || "").includes("Toilet")).length;

    return {
      totalAreaSqFt: Math.round(plotWidth * plotHeight),
      roomCount: rooms.length,
      bedrooms,
      bathrooms,
      openSides,
      coveredSides,
    };
  }, [boundaries, plotHeight, plotWidth, rooms]);

  const overlappingRoomIds = useMemo(() => {
    const overlapping = new Set();

    for (let i = 0; i < rooms.length; i += 1) {
      for (let j = i + 1; j < rooms.length; j += 1) {
        const first = rooms[i];
        const second = rooms[j];
        if (isHall(first) || isHall(second)) continue;

        if (roomsOverlap(first, second)) {
          overlapping.add(first.id);
          overlapping.add(second.id);
        }
      }
    }

    return overlapping;
  }, [rooms]);

  const furnitureByRoomId = useMemo(() => {
    if (!showFurniture) return new Map();

    const nextMap = new Map();
    for (const room of rooms) {
      nextMap.set(room.id, placeFurniture(room));
    }
    return nextMap;
  }, [rooms, showFurniture]);

  const isEditingDragInProgress = !isPresentationMode && draggingRoomId !== null;

  useEffect(() => {
    if (isPresentationMode && !showFurniture) {
      setShowFurniture(true);
    }
  }, [isPresentationMode, showFurniture]);

  /* When the backend returns a new layout, hydrate it immediately.
     This is the "algorithm-first" rule: whatever the backend returns
     completely replaces the canvas state. */
  useEffect(() => {
    setRooms(normalizeIncomingRooms(initialRooms));
    setSelectedId(null);
    setIsTransforming(false);
    setDraggingRoomId(null);
  }, [initialRooms]);

  useEffect(() => {
    if (typeof onRoomsChange === "function") {
      onRoomsChange(rooms);
    }
  }, [onRoomsChange, rooms]);

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
    const majorStroke = isDarkTheme
      ? (isPresentationMode ? "rgba(137, 205, 217, 0.18)" : "rgba(156, 240, 255, 0.2)")
      : (isPresentationMode ? "rgba(122, 124, 111, 0.24)" : "rgba(122, 124, 111, 0.16)");
    const minorStroke = isDarkTheme
      ? (isPresentationMode ? "rgba(137, 205, 217, 0.055)" : "rgba(156, 240, 255, 0.07)")
      : (isPresentationMode ? "rgba(178, 179, 165, 0.16)" : "rgba(178, 179, 165, 0.09)");

    for (let column = 0; column <= grid.columns; column += 1) {
      if (isPresentationMode && column % 4 !== 0) continue;
      const x = column * cellWidth;
      lines.push(
        <Line
          key={`column-${column}`}
          listening={false}
          points={[x, 0, x, stageHeight]}
          stroke={column % 16 === 0 ? majorStroke : minorStroke}
          strokeWidth={column % 16 === 0 ? 0.95 : 0.45}
        />,
      );
    }

    for (let row = 0; row <= grid.rows; row += 1) {
      if (isPresentationMode && row % 4 !== 0) continue;
      const y = row * cellHeight;
      lines.push(
        <Line
          key={`row-${row}`}
          listening={false}
          points={[0, y, stageWidth, y]}
          stroke={row % 16 === 0 ? majorStroke : minorStroke}
          strokeWidth={row % 16 === 0 ? 0.95 : 0.45}
        />,
      );
    }

    return lines;
  }, [cellHeight, cellWidth, grid.columns, grid.rows, isDarkTheme, isPresentationMode, stageHeight, stageWidth]);

  const activateRoom = (roomId) => {
    setSelectedId(roomId);
  };

  const handleRoomPointerDown = (roomId, event) => {
    if (isPresentationMode) return;
    // Pointer-down selection is more reliable than click across zoom/DPI/browser differences.
    activateRoom(roomId);
    if (event?.cancelBubble !== undefined) {
      event.cancelBubble = false;
    }
  };

  const bindGroupRef = (roomId, node) => {
    if (!node) groupRefs.current.delete(roomId);
    else groupRefs.current.set(roomId, node);
  };

  const bindShapeRef = (roomId, node) => {
    if (!node) shapeRefs.current.delete(roomId);
    else shapeRefs.current.set(roomId, node);
  };

  const findRoomAtStagePoint = (stagePoint) => {
    if (!stagePoint) return null;

    // Search from top-most drawn room to bottom-most.
    for (let index = rooms.length - 1; index >= 0; index -= 1) {
      const room = rooms[index];
      const roomX = (room.x / plotWidth) * stageWidth;
      const roomY = (room.y / plotHeight) * stageHeight;
      const roomW = (room.width / plotWidth) * stageWidth;
      const roomH = (room.height / plotHeight) * stageHeight;

      if (
        stagePoint.x >= roomX &&
        stagePoint.x <= roomX + roomW &&
        stagePoint.y >= roomY &&
        stagePoint.y <= roomY + roomH
      ) {
        return room.id;
      }
    }

    return null;
  };

  const showEditorToast = (message) => {
    setEditorToast(message);

    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = setTimeout(() => {
      setEditorToast("");
      toastTimeoutRef.current = null;
    }, 2600);
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
    const selectedRoom = rooms.find((room) => room.id === selectedId);
    if (selectedRoom && isHall(selectedRoom)) return;
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
      showEditorToast("No valid ventilation wall available. Place this room against an open boundary, a Shaft, or a Balcony.");
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

  /* ── Flip Door Swing ── */
  const flipDoor = (roomId, doorId) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    updateRoom(roomId, {
      doors: (room.doors || []).map(d => 
        d.id === doorId ? { ...d, swingState: ((d.swingState || 0) + 1) % 4 } : d
      ),
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

    const arcNode = parentGroup.findOne('.doorArc');
    const panelNode = parentGroup.findOne('.doorPanel');
    
    if (arcNode && panelNode) {
      const rectX = node.x();
      const rectY = node.y();
      const w = node.width();
      const h = node.height();
      const { arcX, arcY, rotation, panelPoints, panelLen } = getDoorRenderingState(currentWall, element.swingState || 0, rectX, rectY, w, h);
      
      arcNode.setAttrs({ x: arcX, y: arcY, panelLen: panelLen, rotation: rotation });
      panelNode.points(panelPoints);
    }

    const cutoutNode = parentGroup.findOne('.cutout');
    if (cutoutNode) {
      const rectX = node.x();
      const rectY = node.y();
      const w = node.width();
      const h = node.height();
      if (currentWall === "top" || currentWall === "bottom") {
        cutoutNode.setAttrs({ x: rectX, y: rectY + h/2 - 3, width: w, height: 6 });
      } else {
        cutoutNode.setAttrs({ x: rectX + w/2 - 3, y: rectY, width: 6, height: h });
      }
    }

    const paneNode1 = parentGroup.findOne('.pane1');
    const paneNode2 = parentGroup.findOne('.pane2');
    if (paneNode1 && paneNode2) {
      const rectX = node.x();
      const rectY = node.y();
      const w = node.width();
      const h = node.height();
      if (currentWall === "top" || currentWall === "bottom") {
        paneNode1.points([rectX, rectY + h/2 - 2, rectX + w, rectY + h/2 - 2]);
        paneNode2.points([rectX, rectY + h/2 + 2, rectX + w, rectY + h/2 + 2]);
      } else {
        paneNode1.points([rectX + w/2 - 2, rectY, rectX + w/2 - 2, rectY + h]);
        paneNode2.points([rectX + w/2 + 2, rectY, rectX + w/2 + 2, rectY + h]);
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
    <div ref={editorShellRef} className={`editor-shell ${isPresentationMode ? "presentation-sheet" : ""}`}>
      <div className="furniture-toggle-container">
        <button 
          className={`furniture-toggle-btn mode-toggle-btn mode-left-btn ${!isPresentationMode ? 'active' : ''}`}
          onClick={() => setIsPresentationMode(false)}
        >
          Edit
        </button>
        <button 
          className={`furniture-toggle-btn mode-toggle-btn mode-right-btn ${isPresentationMode ? 'active' : ''}`}
          onClick={() => {
            setIsPresentationMode(true);
            setSelectedId(null);
          }}
        >
          Present
        </button>
        <button 
          className={`furniture-toggle-btn toolbar-furniture-btn ${showFurniture ? 'active' : ''}`}
          onClick={() => setShowFurniture(!showFurniture)}
        >
          {showFurniture ? "Furniture On" : "Furniture Off"}
        </button>
      </div>
      {editorToast ? (
        <div className="editor-toast" role="status" aria-live="polite">
          {editorToast}
        </div>
      ) : null}
      {isPresentationMode && (
        <div className="presentation-header">
          <h3>{isDarkTheme ? "MONOLITH CAD // PRESENTATION" : "ArchAI // Atelier Presentation"}</h3>
          <p>
            {formatPlotSize(plotWidth)} x {formatPlotSize(plotHeight)} | {planSummary.totalAreaSqFt} sq ft
          </p>
        </div>
      )}
      <div
        className={`editor-canvas ${isPresentationMode ? "presentation-canvas" : ""}`}
        onPointerDown={(event) => {
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
          onPointerDown={(event) => {
            if (isPresentationMode) return;

            const stage = event.target?.getStage?.();
            const pointer = stage?.getPointerPosition?.();
            const roomId = findRoomAtStagePoint(pointer);

            if (roomId) {
              setSelectedId(roomId);
              return;
            }

            if (event.target === stage) {
              setSelectedId(null);
            }
          }}
          width={stageWidth}
        >
          <Layer listening={false}>
            <Rect
              fill={isDarkTheme ? (isPresentationMode ? "#171a1b" : "#121416") : (isPresentationMode ? "#fbf9f2" : "#f5f4eb")}
              height={stageHeight}
              width={stageWidth}
              x={0}
              y={0}
            />
            {isPresentationMode && (
              <>
                <Rect
                  x={8}
                  y={8}
                  width={stageWidth - 16}
                  height={stageHeight - 16}
                  stroke={isDarkTheme ? "rgba(0, 229, 255, 0.45)" : "rgba(122, 124, 111, 0.5)"}
                  strokeWidth={1.8}
                  listening={false}
                />
              </>
            )}
          </Layer>

          <Layer listening={false} opacity={isPresentationMode ? (isDarkTheme ? 0.34 : 0.62) : 1}>
            {gridLines}
            <Rect
              fill="transparent"
              height={stageHeight}
              stroke={isDarkTheme
                ? (isPresentationMode ? "rgba(120, 181, 192, 0.65)" : "rgba(120, 181, 192, 0.45)")
                : (isPresentationMode ? "rgba(122, 124, 111, 0.52)" : "rgba(122, 124, 111, 0.34)")}
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
              isDarkTheme={isDarkTheme}
            />
          </Layer>

          <Layer>
            {rooms.map((room) => {
              const roomX = Math.round((room.x / plotWidth) * stageWidth);
              const roomY = Math.round((room.y / plotHeight) * stageHeight);
              const roomRightPx = Math.round(((room.x + room.width) / plotWidth) * stageWidth);
              const roomBottomPx = Math.round(((room.y + room.height) / plotHeight) * stageHeight);
              const roomWidthPx = Math.max(1, roomRightPx - roomX);
              const roomHeightPx = Math.max(1, roomBottomPx - roomY);
              const labelFontSize = Math.max(
                isPresentationMode ? 11 : 10,
                Math.min(isPresentationMode ? 18 : 15, roomWidthPx * 0.09, roomHeightPx * 0.22),
              );
              const wallDimensionFontSize = Math.max(
                isPresentationMode ? 9 : 8,
                Math.min(12, roomWidthPx * 0.065, roomHeightPx * 0.14),
              );
              const labelTextHeight = labelFontSize + 6;
              const widthDimText = formatFeet(room.width);
              const heightDimText = formatFeet(room.height);
              const compactDimText = `${widthDimText} x ${heightDimText}`;
              const showWallDimensions = isPresentationMode
                ? roomWidthPx >= 118 && roomHeightPx >= 88
                : roomWidthPx >= 92 && roomHeightPx >= 78;
              const showSideDimension = showWallDimensions && roomWidthPx >= (isPresentationMode ? 136 : 116);
              const showCompactDimension = !showWallDimensions
                && roomWidthPx >= (isPresentationMode ? 88 : 70)
                && roomHeightPx >= (isPresentationMode ? 62 : 54);
              const topDimChipHeight = wallDimensionFontSize + 6;
              const compactDimChipHeight = wallDimensionFontSize + 6;
              const topReserve = showWallDimensions ? topDimChipHeight + 8 : 6;
              const bottomReserve = showCompactDimension ? compactDimChipHeight + 8 : 6;
              const labelAvailableHeight = Math.max(0, roomHeightPx - topReserve - bottomReserve);
              const labelY = clamp(
                topReserve + (labelAvailableHeight - labelTextHeight) / 2,
                4,
                Math.max(4, roomHeightPx - labelTextHeight - 4),
              );
              const canRenderLabel = roomWidthPx >= 44 && labelAvailableHeight >= labelTextHeight;
              const labelText = fitTextToWidth(room.label, roomWidthPx - 18, labelFontSize);
              const labelChipWidth = Math.min(
                Math.max(40, labelText.length * labelFontSize * 0.62 + 14),
                Math.max(28, roomWidthPx - 10),
              );
              const labelChipX = Math.max(5, (roomWidthPx - labelChipWidth) / 2);
              const topDimChipWidth = Math.min(
                Math.max(44, widthDimText.length * wallDimensionFontSize * 0.62 + 14),
                Math.max(30, roomWidthPx - 10),
              );
              const topDimChipX = Math.max(5, (roomWidthPx - topDimChipWidth) / 2);
              const leftDimChipHeight = Math.min(
                Math.max(44, heightDimText.length * wallDimensionFontSize * 0.62 + 16),
                Math.max(30, roomHeightPx - 10),
              );
              const leftDimChipY = Math.max(5, (roomHeightPx - leftDimChipHeight) / 2);
              const compactDimChipWidth = Math.min(
                Math.max(56, compactDimText.length * wallDimensionFontSize * 0.56 + 16),
                Math.max(34, roomWidthPx - 10),
              );
              const compactDimChipX = Math.max(5, (roomWidthPx - compactDimChipWidth) / 2);
              const compactDimChipY = roomHeightPx - (wallDimensionFontSize + 10);
              const labelChipFill = isPresentationMode
                ? (isDarkTheme ? "rgba(11, 17, 18, 0.88)" : "rgba(255, 255, 255, 0.87)")
                : "rgba(255, 255, 255, 0.72)";
              const dimChipFill = isPresentationMode
                ? (isDarkTheme ? "rgba(14, 21, 23, 0.85)" : "rgba(245, 244, 235, 0.82)")
                : "rgba(255, 255, 255, 0.72)";

              const isSelected = room.id === selectedId;
              const isOverlapping = overlappingRoomIds.has(room.id);

              const roomVisual = getRoomPresentationStyle(room, isPresentationMode, isSelected, isOverlapping, isDarkTheme);

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
                  draggable={!isPresentationMode}
                  key={room.id}
                  onPointerDown={isPresentationMode ? undefined : (event) => handleRoomPointerDown(room.id, event)}
                  onMouseDown={isPresentationMode ? undefined : (event) => handleRoomPointerDown(room.id, event)}
                  onClick={isPresentationMode ? undefined : () => activateRoom(room.id)}
                  onDragStart={isPresentationMode ? undefined : () => {
                    activateRoom(room.id);
                    setDraggingRoomId(room.id);
                  }}
                  onDragEnd={(event) => {
                    setDraggingRoomId(null);
                    const rawX = event.target.x() / pixelsPerPlotUnitX;
                    const rawY = event.target.y() / pixelsPerPlotUnitY;

                    setRooms((currentRooms) => {
                      const movingRoom = currentRooms.find((entry) => entry.id === room.id);
                      if (!movingRoom) {
                        return currentRooms;
                      }

                      const nextPosition = resolveDraggedRoomPosition(
                        movingRoom,
                        rawX,
                        rawY,
                        currentRooms,
                      );

                      return currentRooms.map((entry) => (
                        entry.id === room.id
                          ? { ...entry, ...nextPosition }
                          : entry
                      ));
                    });
                  }}
                  onTap={isPresentationMode ? undefined : () => activateRoom(room.id)}
                  ref={(node) => bindGroupRef(room.id, node)}
                  x={roomX}
                  y={roomY}
                >
                  <Rect
                    ref={(node) => bindShapeRef(room.id, node)}
                    cornerRadius={0}
                    fill={roomVisual.fill}
                    height={roomHeightPx}
                    strokeEnabled={false}
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

                  {isPresentationMode && (
                    <Group listening={false} opacity={0.48}>
                      {roomTextureLines(roomVisual.texture, roomWidthPx, roomHeightPx)}
                    </Group>
                  )}
                  
                  {/* ── Thick Wall Segments ── */}
                  {(() => {
                    const t = 1;
                    const isTopExternal = room.y <= t;
                    const isBottomExternal = room.y + room.height >= plotHeight - t;
                    const isLeftExternal = room.x <= t;
                    const isRightExternal = room.x + room.width >= plotWidth - t;
                    
                    const strokeColor = roomVisual.wallStroke;
                    
                    return (
                      <Group listening={false}>
                        <Line points={[0, 0, roomWidthPx, 0]} stroke={strokeColor} strokeWidth={isTopExternal ? 6 : 3} lineCap="square" />
                        <Line points={[0, roomHeightPx, roomWidthPx, roomHeightPx]} stroke={strokeColor} strokeWidth={isBottomExternal ? 6 : 3} lineCap="square" />
                        <Line points={[0, 0, 0, roomHeightPx]} stroke={strokeColor} strokeWidth={isLeftExternal ? 6 : 3} lineCap="square" />
                        <Line points={[roomWidthPx, 0, roomWidthPx, roomHeightPx]} stroke={strokeColor} strokeWidth={isRightExternal ? 6 : 3} lineCap="square" />
                      </Group>
                    );
                  })()}

                  {/* Render furniture beneath labels/dimensions to keep text readable. */}
                  {showFurniture && !isEditingDragInProgress && (
                    <Group listening={false} opacity={isPresentationMode ? 0.58 : 0.8}>
                      {(furnitureByRoomId.get(room.id) || []).map((item, i) => (
                        <FurniturePiece
                          key={i}
                          item={item}
                          pxX={pixelsPerPlotUnitX}
                          pxY={pixelsPerPlotUnitY}
                        />
                      ))}
                    </Group>
                  )}

                  {isSelected && !isPresentationMode && (
                    <Rect
                      listening={false}
                      x={2}
                      y={2}
                      width={Math.max(0, roomWidthPx - 4)}
                      height={Math.max(0, roomHeightPx - 4)}
                      stroke={isDarkTheme ? "#00e5ff" : "#476362"}
                      strokeWidth={1.8}
                      dash={[8, 4]}
                      shadowColor={isDarkTheme ? "#00e5ff" : "#476362"}
                      shadowBlur={8}
                      shadowOpacity={isDarkTheme ? 0.38 : 0.2}
                    />
                  )}

                  {isOverlapping && (
                    <Text
                      x={roomWidthPx / 2 - 30} y={roomHeightPx - 15}
                      text="⚠️ Overlapping"
                      fill="#ef4444"
                      fontSize={Math.max(8, wallDimensionFontSize * 0.9)}
                      fontStyle="bold"
                      listening={false}
                    />
                  )}
                  {!(isTransforming && isSelected) && canRenderLabel && (
                    <Group>
                      <Rect
                        x={labelChipX}
                        y={Math.max(4, labelY - 1)}
                        width={labelChipWidth}
                        height={labelTextHeight}
                        cornerRadius={6}
                        fill={labelChipFill}
                        listening={false}
                      />
                      <Text
                        align="center"
                        fontFamily="Inter, sans-serif"
                        fontSize={labelFontSize}
                        fontStyle="bold"
                        fill={roomVisual.labelColor}
                        height={labelTextHeight}
                        listening={false}
                        padding={3}
                        stroke={isPresentationMode ? (isDarkTheme ? "rgba(3, 8, 9, 0.75)" : "rgba(255, 255, 255, 0.78)") : undefined}
                        strokeWidth={isPresentationMode ? 0.45 : 0}
                        text={labelText}
                        verticalAlign="middle"
                        width={labelChipWidth}
                        x={labelChipX}
                        y={labelY}
                      />

                      {showWallDimensions && (
                        <>
                          <Rect
                            x={topDimChipX}
                            y={2}
                            width={topDimChipWidth}
                            height={topDimChipHeight}
                            cornerRadius={4}
                            fill={dimChipFill}
                            listening={false}
                          />
                          <Text
                            align="center"
                            fill={roomVisual.dimensionColor}
                            fontFamily="Inter, sans-serif"
                            fontSize={wallDimensionFontSize}
                            listening={false}
                            text={widthDimText}
                            width={topDimChipWidth}
                            x={topDimChipX}
                            y={3}
                          />
                          {showSideDimension && (
                            <>
                              <Rect
                                x={3}
                                y={leftDimChipY}
                                width={wallDimensionFontSize + 7}
                                height={leftDimChipHeight}
                                cornerRadius={4}
                                fill={dimChipFill}
                                listening={false}
                              />
                              <Text
                                align="center"
                                fill={roomVisual.dimensionColor}
                                fontFamily="Inter, sans-serif"
                                fontSize={wallDimensionFontSize}
                                listening={false}
                                text={heightDimText}
                                width={leftDimChipHeight}
                                x={4}
                                y={leftDimChipY + leftDimChipHeight}
                                rotation={-90}
                              />
                            </>
                          )}
                        </>
                      )}

                      {showCompactDimension && (
                        <>
                          <Rect
                            x={compactDimChipX}
                            y={compactDimChipY}
                            width={compactDimChipWidth}
                            height={compactDimChipHeight}
                            cornerRadius={4}
                            fill={dimChipFill}
                            listening={false}
                          />
                          <Text
                            align="center"
                            fill={roomVisual.dimensionColor}
                            fontFamily="Inter, sans-serif"
                            fontSize={wallDimensionFontSize}
                            listening={false}
                            text={compactDimText}
                            width={compactDimChipWidth}
                            x={compactDimChipX}
                            y={compactDimChipY + 1}
                          />
                        </>
                      )}

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
                              fontSize={wallDimensionFontSize * 1.5}
                              x={roomWidthPx - (wallDimensionFontSize * 1.5) - 4}
                              y={showWallDimensions ? topDimChipHeight + 4 : 4}
                              listening={false}
                            />
                          );
                        }
                      }
                    }
                    return null;
                  })()}

                  {/* ── Doors ── */}
                  {(room.doors || []).map((door) => {
                    const rect = getElementPixelRect(door, room, plotWidth, plotHeight, stageWidth, stageHeight, DOOR_DEPTH_FT);
                    const isHorizontal = door.wall === "top" || door.wall === "bottom";
                    const { arcX, arcY, rotation, panelPoints, panelLen } = getDoorRenderingState(door.wall, door.swingState || 0, rect.x, rect.y, rect.w, rect.h);

                    return (
                      <Group key={door.id}>
                        <Rect
                          x={rect.x}
                          y={rect.y}
                          width={rect.w}
                          height={rect.h}
                          fill="transparent"
                          draggable
                          dragBoundFunc={(pos) => getElementDragBound(pos, door, room, DOOR_DEPTH_FT)}
                          onMouseEnter={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = "grab";
                            e.target.setAttrs({ stroke: "rgba(59, 130, 246, 0.5)", strokeWidth: 4, cornerRadius: 4 });
                          }}
                          onMouseLeave={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = "default";
                            e.target.setAttrs({ stroke: null, strokeWidth: 0, cornerRadius: 0 });
                          }}
                          onDragStart={(e) => { e.cancelBubble = true; }}
                          onDragMove={(e) => {
                            e.cancelBubble = true;
                            handleElementDragMove(e, door, room, DOOR_DEPTH_FT);
                          }}
                          onDragEnd={(e) => {
                            e.cancelBubble = true;
                            handleElementDragEnd(e, door, room, updateDoorState);
                            e.target.position({ x: rect.x, y: rect.y });
                          }}
                          onClick={(e) => {
                            e.cancelBubble = true;
                            flipDoor(room.id, door.id);
                          }}
                          onDblClick={(e) => {
                            e.cancelBubble = true;
                            removeDoor(room.id, door.id);
                          }}
                          onDblTap={(e) => {
                            e.cancelBubble = true;
                            removeDoor(room.id, door.id);
                          }}
                        />
                        <Group listening={false}>
                          <Rect
                            name="cutout"
                            x={isHorizontal ? rect.x : rect.x + rect.w/2 - 3}
                            y={isHorizontal ? rect.y + rect.h/2 - 3 : rect.y}
                            width={isHorizontal ? rect.w : 6}
                            height={isHorizontal ? 6 : rect.h}
                            fill="#ffffff"
                          />
                          <Line
                            name="doorPanel"
                            points={panelPoints}
                            stroke="#111827"
                            strokeWidth={3}
                            lineCap="round"
                          />
                          <Shape
                            name="doorArc"
                            x={arcX}
                            y={arcY}
                            panelLen={panelLen}
                            rotation={rotation}
                            sceneFunc={(context, shape) => {
                              context.beginPath();
                              context.arc(0, 0, shape.getAttr('panelLen'), 0, Math.PI / 2, false);
                              context.strokeShape(shape);
                            }}
                            stroke="#6b7280"
                            strokeWidth={1.5}
                            dash={[4, 4]}
                          />
                        </Group>
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
                          fill="transparent"
                          draggable
                          dragBoundFunc={(pos) => getElementDragBound(pos, win, room, WINDOW_DEPTH_FT)}
                          onMouseEnter={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = "grab";
                            e.target.setAttrs({ stroke: "rgba(59, 130, 246, 0.5)", strokeWidth: 4, cornerRadius: 4 });
                          }}
                          onMouseLeave={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = "default";
                            e.target.setAttrs({ stroke: null, strokeWidth: 0, cornerRadius: 0 });
                          }}
                          onDragStart={(e) => { e.cancelBubble = true; }}
                          onDragMove={(e) => {
                            e.cancelBubble = true;
                            handleElementDragMove(e, win, room, WINDOW_DEPTH_FT);
                          }}
                          onDragEnd={(e) => {
                            e.cancelBubble = true;
                            handleElementDragEnd(e, win, room, updateWindowState);
                            e.target.position({ x: rect.x, y: rect.y });
                          }}
                          onDblClick={(e) => {
                            e.cancelBubble = true;
                            removeWindow(room.id, win.id);
                          }}
                          onDblTap={(e) => {
                            e.cancelBubble = true;
                            removeWindow(room.id, win.id);
                          }}
                        />
                        <Group listening={false}>
                          <Rect
                            name="cutout"
                            x={isHorizontal ? rect.x : rect.x + rect.w/2 - 3}
                            y={isHorizontal ? rect.y + rect.h/2 - 3 : rect.y}
                            width={isHorizontal ? rect.w : 6}
                            height={isHorizontal ? 6 : rect.h}
                            fill="#ffffff"
                          />
                          <Rect
                            name="glassBody"
                            x={isHorizontal ? rect.x : rect.x + rect.w/2 - 4}
                            y={isHorizontal ? rect.y + rect.h/2 - 4 : rect.y}
                            width={isHorizontal ? rect.w : 8}
                            height={isHorizontal ? 8 : rect.h}
                            fill="#38bdf8"
                            cornerRadius={2}
                            shadowColor="#0284c7"
                            shadowBlur={5}
                            shadowOpacity={0.6}
                            shadowOffsetY={2}
                          />
                          <Line
                            name="pane1"
                            points={isHorizontal ? 
                              [rect.x + 2, rect.y + rect.h/2 - 1.5, rect.x + rect.w - 2, rect.y + rect.h/2 - 1.5] : 
                              [rect.x + rect.w/2 - 1.5, rect.y + 2, rect.x + rect.w/2 - 1.5, rect.y + rect.h - 2]}
                            stroke="#ffffff"
                            strokeWidth={1.5}
                            opacity={0.8}
                          />
                          <Line
                            name="pane2"
                            points={isHorizontal ? 
                              [rect.x + 2, rect.y + rect.h/2 + 1.5, rect.x + rect.w - 2, rect.y + rect.h/2 + 1.5] : 
                              [rect.x + rect.w/2 + 1.5, rect.y + 2, rect.x + rect.w/2 + 1.5, rect.y + rect.h - 2]}
                            stroke="#ffffff"
                            strokeWidth={1.5}
                            opacity={0.8}
                          />
                        </Group>
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
            <CompassIndicator
              frontDirection={frontDirection}
              stageWidth={stageWidth}
              isDarkTheme={isDarkTheme}
              showFrontLabel={!isPresentationMode}
            />
          </Layer>

          {/* Dedicated top layer for the Transformer so its handles are always
              above every room Group and can never be intercepted by them */}
          <Layer>
            <Transformer
              anchorFill="#476362"
              anchorStroke="#fbf9f2"
              anchorStrokeWidth={1.2}
              anchorSize={10}
              anchorDragBoundFunc={(_oldPosition, newPosition) => ({
                x: newPosition.x,
                y: newPosition.y,
              })}
              borderStroke="#476362"
              borderStrokeWidth={1.8}
              borderDash={[6, 4]}
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
      {selectedRoom && !isPresentationMode && (
        <div className="room-actions-panel">
          <div className="room-actions-header">
            <span className="room-actions-title">{selectedRoom.label}</span>
            <span className="room-actions-dims">
              {formatFeet(selectedRoom.width)} × {formatFeet(selectedRoom.height)}
            </span>
          </div>
          <label className="room-name-edit-label">
            Room Name
            <input
              className="room-name-edit-input"
              value={selectedRoom.label}
              onChange={(event) => updateSelectedRoomLabel(event.target.value)}
              placeholder="Enter room name"
            />
          </label>
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
            {!(selectedRoom && isHall(selectedRoom)) && (
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
                  <button className="action-icon-btn" onClick={() => flipDoor(selectedRoom.id, door.id)} title="Flip door swing">🔄</button>
                  <button className="action-icon-btn remove-btn" onClick={() => removeDoor(selectedRoom.id, door.id)} title="Remove door">×</button>
                </span>
              ))}
              {(selectedRoom.windows || []).map((win) => (
                <span className="room-element-tag window-tag" key={win.id}>
                  🪟 {win.wall}
                  <button className="action-icon-btn remove-btn" onClick={() => removeWindow(selectedRoom.id, win.id)} title="Remove window">×</button>
                </span>
              ))}
            </div>
          )}
          <p className="room-actions-hint">Double-click a door/window on canvas to remove it. Drag to reposition along wall.</p>
        </div>
      )}

      {/* ── Add Room Toolbar ── */}
      {!isPresentationMode && (
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
      )}
    </div>
  );
}

export default GridFloorPlanEditor;
