import { useCallback, useEffect, useRef, useState } from "react";
import GridFloorPlanEditor from "./GridFloorPlanEditor";
import DesignDashboard from "./DesignDashboard";

const initialForm = {
  plotGaj: 200,
  plotShape: "rectangle",
  dwellingType: "house",
  bedrooms: 3,
  bathrooms: 2,
  frontDirection: "south",
  engine: "v1",
};

const CARDINAL_DIRECTIONS = ["north", "east", "south", "west"];

function createDefaultDesignName() {
  const date = new Date();
  return `Design ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function normalizeBoundaries(nextBoundaries, frontDirection) {
  const safeFrontDirection = CARDINAL_DIRECTIONS.includes(frontDirection)
    ? frontDirection
    : initialForm.frontDirection;
  const source = nextBoundaries && typeof nextBoundaries === "object" ? nextBoundaries : {};

  return CARDINAL_DIRECTIONS.reduce((acc, direction) => {
    if (direction === safeFrontDirection) {
      acc[direction] = "front";
    } else {
      acc[direction] = source[direction] === "open" ? "open" : "covered";
    }
    return acc;
  }, {});
}

function normalizeRoomForSave(room) {
  return {
    ...room,
    doors: Array.isArray(room?.doors) ? room.doors : [],
    windows: Array.isArray(room?.windows) ? room.windows : [],
  };
}

function toSafeNumber(value, fallback) {
  const nextNumber = Number(value);
  return Number.isFinite(nextNumber) ? nextNumber : fallback;
}

function CustomSelect({ name, value, options, onChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isOpen]);

  const selectedOption = options.find((option) => option.value === value);

  const handleTriggerKeyDown = (event) => {
    if (event.key === " " || event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
    }
    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className={`custom-select ${isOpen ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedOption?.label ?? placeholder}</span>
        <span className="custom-select-chevron" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="custom-select-menu" role="listbox" aria-label={name}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`custom-select-option ${option.value === value ? "selected" : ""}`}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(name, option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function App({
  authToken = "",
  authUser = null,
  onAuthExpired,
}) {
  const [themeMode, setThemeMode] = useState(() => {
    if (typeof window === "undefined") return "light";
    const storedTheme = window.localStorage.getItem("floorplan-theme");
    return storedTheme === "dark" ? "dark" : "light";
  });

  const [form, setForm] = useState(initialForm);
  const [plot, setPlot] = useState({
    plotWidth: 40,
    plotHeight: 50,
    plotGaj: initialForm.plotGaj,
    plotShape: initialForm.plotShape,
  });

  const [boundaries, setBoundaries] = useState(() =>
    normalizeBoundaries(
      {
        north: "covered",
        east: "open",
        south: "front",
        west: "covered",
      },
      initialForm.frontDirection,
    ),
  );

  const [initialRooms, setInitialRooms] = useState([]);
  const [roomsDraft, setRoomsDraft] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [importJson, setImportJson] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [schemaCopyFeedback, setSchemaCopyFeedback] = useState("");

  const [activeView, setActiveView] = useState("editor");
  const [savedDesigns, setSavedDesigns] = useState([]);
  const [isDesignsLoading, setIsDesignsLoading] = useState(false);
  const [designError, setDesignError] = useState("");
  const [designName, setDesignName] = useState(createDefaultDesignName);
  const [currentDesignId, setCurrentDesignId] = useState("");
  const [currentDesignUpdatedAt, setCurrentDesignUpdatedAt] = useState("");
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [isDeletingDesignId, setIsDeletingDesignId] = useState("");
  const [saveFeedback, setSaveFeedback] = useState("");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const hasAutoGenerated = useRef(false);
  const profileMenuRef = useRef(null);

  const clearDesignLink = useCallback(() => {
    setCurrentDesignId("");
    setCurrentDesignUpdatedAt("");
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => {
      const updated = { ...current, [name]: value };

      if (name === "frontDirection") {
        setBoundaries((prev) => normalizeBoundaries(prev, value));
      }

      return updated;
    });
  };

  const handleBoundaryToggle = (direction) => {
    setBoundaries((prev) => {
      if (!CARDINAL_DIRECTIONS.includes(direction) || prev[direction] === "front") {
        return prev;
      }

      const nextStatus = prev[direction] === "covered" ? "open" : "covered";
      return normalizeBoundaries(
        {
          ...prev,
          [direction]: nextStatus,
        },
        form.frontDirection,
      );
    });
  };

  const handleSelectChange = (name, value) => {
    handleChange({ target: { name, value } });
  };

  const handleEditorRoomsChange = useCallback((nextRooms) => {
    setRoomsDraft(Array.isArray(nextRooms) ? nextRooms.map((room) => normalizeRoomForSave(room)) : []);
  }, []);

  const upsertDesignInState = useCallback((nextDesign) => {
    setSavedDesigns((currentDesigns) => {
      const existingIndex = currentDesigns.findIndex((design) => String(design.id) === String(nextDesign.id));
      if (existingIndex === -1) {
        return [nextDesign, ...currentDesigns];
      }

      const cloned = [...currentDesigns];
      cloned[existingIndex] = nextDesign;
      cloned.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return cloned;
    });
  }, []);

  const authorizedDesignFetch = useCallback(async (path, options = {}) => {
    if (!authToken) {
      throw new Error("You need to be logged in to manage designs.");
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      ...(options.headers || {}),
    };

    const response = await fetch(path, {
      ...options,
      headers,
    });

    if (response.status === 401 && typeof onAuthExpired === "function") {
      onAuthExpired();
      throw new Error("Session expired. Please log in again.");
    }

    return response;
  }, [authToken, onAuthExpired]);

  const loadSavedDesigns = useCallback(async (withSpinner = true) => {
    if (!authToken) {
      setSavedDesigns([]);
      return;
    }

    if (withSpinner) {
      setIsDesignsLoading(true);
    }

    setDesignError("");

    try {
      const response = await authorizedDesignFetch("/api/designs");
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Could not load saved designs.");
      }

      setSavedDesigns(Array.isArray(payload.designs) ? payload.designs : []);
    } catch (requestError) {
      setDesignError(requestError.message || "Could not load saved designs.");
    } finally {
      if (withSpinner) {
        setIsDesignsLoading(false);
      }
    }
  }, [authToken, authorizedDesignFetch]);

  useEffect(() => {
    loadSavedDesigns();
  }, [loadSavedDesigns]);

  const buildDesignDataPayload = useCallback(() => {
    return {
      plot: {
        width: plot.plotWidth,
        height: plot.plotHeight,
        gaj: plot.plotGaj,
        shape: plot.plotShape,
        front: form.frontDirection,
      },
      boundaries: normalizeBoundaries(boundaries, form.frontDirection),
      form: {
        plotGaj: form.plotGaj,
        plotShape: form.plotShape,
        dwellingType: form.dwellingType,
        bedrooms: form.bedrooms,
        bathrooms: form.bathrooms,
        frontDirection: form.frontDirection,
        engine: form.engine,
      },
      layout: roomsDraft.map((room) => normalizeRoomForSave(room)),
    };
  }, [boundaries, form, plot, roomsDraft]);

  const handleSaveDesign = async () => {
    setSaveFeedback("");
    setDesignError("");

    const trimmedName = designName.trim();
    if (!trimmedName) {
      setDesignError("Please enter a design name before saving.");
      return;
    }

    if (!Array.isArray(roomsDraft) || roomsDraft.length === 0) {
      setDesignError("Generate or load a layout before saving.");
      return;
    }

    setIsSavingDesign(true);

    try {
      const path = currentDesignId ? `/api/designs/${currentDesignId}` : "/api/designs";
      const method = currentDesignId ? "PUT" : "POST";

      const response = await authorizedDesignFetch(path, {
        method,
        body: JSON.stringify({
          name: trimmedName,
          designData: buildDesignDataPayload(),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.design) {
        throw new Error(payload.error || "Failed to save design.");
      }

      const saved = payload.design;
      setDesignName(saved.name);
      setCurrentDesignId(saved.id);
      setCurrentDesignUpdatedAt(saved.updatedAt);
      upsertDesignInState(saved);
  setActiveView("editor");
      setSaveFeedback(currentDesignId ? "Design updated successfully." : "Design saved successfully.");
    } catch (saveError) {
      setDesignError(saveError.message || "Failed to save design.");
    } finally {
      setIsSavingDesign(false);
    }
  };

  const handleOpenDesign = (design) => {
    const designData = design?.designData;
    if (!designData || typeof designData !== "object") {
      setDesignError("Selected design is missing data.");
      return;
    }

    const savedFrontDirection = designData?.form?.frontDirection ?? designData?.plot?.front;
    const nextFrontDirection = CARDINAL_DIRECTIONS.includes(savedFrontDirection)
      ? savedFrontDirection
      : form.frontDirection;

    const nextBoundaries = normalizeBoundaries(designData?.boundaries ?? boundaries, nextFrontDirection);

    setForm((prev) => ({
      ...prev,
      plotGaj: toSafeNumber(designData?.form?.plotGaj ?? designData?.plot?.gaj, prev.plotGaj),
      plotShape: designData?.form?.plotShape ?? designData?.plot?.shape ?? prev.plotShape,
      dwellingType: designData?.form?.dwellingType ?? prev.dwellingType,
      bedrooms: toSafeNumber(designData?.form?.bedrooms, prev.bedrooms),
      bathrooms: toSafeNumber(designData?.form?.bathrooms, prev.bathrooms),
      frontDirection: nextFrontDirection,
      engine: designData?.form?.engine ?? prev.engine,
    }));

    setBoundaries(nextBoundaries);

    setPlot((prev) => ({
      plotWidth: toSafeNumber(designData?.plot?.width, prev.plotWidth),
      plotHeight: toSafeNumber(designData?.plot?.height, prev.plotHeight),
      plotGaj: toSafeNumber(designData?.plot?.gaj, prev.plotGaj),
      plotShape: designData?.plot?.shape ?? prev.plotShape,
    }));

    const loadedRooms = Array.isArray(designData?.layout)
      ? designData.layout.map((room) => normalizeRoomForSave(room))
      : [];

    setInitialRooms(loadedRooms);
    setRoomsDraft(loadedRooms);
    setCurrentDesignId(design.id);
    setCurrentDesignUpdatedAt(design.updatedAt);
    setDesignName(design.name);
    setSaveFeedback(`Loaded "${design.name}" for editing.`);
    setActiveView("editor");
    setError("");
    setDesignError("");
  };

  const handleDeleteDesign = async (design) => {
    const designId = design?.id;
    if (!designId) return;

    setDesignError("");
    setSaveFeedback("");
    setIsDeletingDesignId(String(designId));

    try {
      const response = await authorizedDesignFetch(`/api/designs/${designId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Could not delete design.");
      }

      setSavedDesigns((currentDesigns) =>
        currentDesigns.filter((savedDesign) => String(savedDesign.id) !== String(designId)),
      );

      if (String(currentDesignId) === String(designId)) {
        clearDesignLink();
        setDesignName(createDefaultDesignName());
        setSaveFeedback("Deleted selected design.");
      } else {
        setSaveFeedback(`Deleted "${design?.name || "design"}".`);
      }
    } catch (deleteError) {
      setDesignError(deleteError.message || "Could not delete design.");
    } finally {
      setIsDeletingDesignId("");
    }
  };

  const handleNewDesign = () => {
    clearDesignLink();
    setDesignName(createDefaultDesignName());
    setSaveFeedback("Switched to new design mode.");
  };

  const requestLayout = async (nextPlot) => {
    setIsLoading(true);
    setError("");

    try {
      const normalizedBoundaries = normalizeBoundaries(
        boundaries,
        nextPlot.frontDirection ?? form.frontDirection,
      );

      const response = await fetch("/api/layout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...nextPlot,
          boundaries: normalizedBoundaries,
          engine: nextPlot.engine ?? "v1",
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate layout.");
      }

      setPlot({
        plotWidth: payload?.plot?.width ?? nextPlot.plotWidth,
        plotHeight: payload?.plot?.height ?? nextPlot.plotHeight,
        plotGaj: payload?.plot?.gaj ?? nextPlot.plotGaj,
        plotShape: payload?.plot?.shape ?? nextPlot.plotShape,
      });
      const generatedRooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
      setInitialRooms(generatedRooms);
      setRoomsDraft(generatedRooms);
      clearDesignLink();
      setCurrentDesignUpdatedAt("");
      setDesignName(createDefaultDesignName());
      setSaveFeedback("");
    } catch (requestError) {
      setInitialRooms([]);
      setRoomsDraft([]);
      setError(
        requestError instanceof TypeError
          ? "Could not reach the backend. Start the backend server and try again."
          : requestError.message,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportLayout = () => {
    if (!importJson.trim()) return;
    setError("");

    try {
      const payload = JSON.parse(importJson);

      if (!payload.plot || !payload.layout) {
        throw new Error("Invalid JSON format. Expected 'plot' and 'layout' keys.");
      }

      setPlot({
        plotWidth: Number(payload.plot.width),
        plotHeight: Number(payload.plot.height),
        plotGaj: Number(payload.plot.gaj) || plot.plotGaj,
        plotShape: payload.plot.shape || plot.plotShape,
      });

      const requestedFrontDirection = payload?.plot?.front;
      const importedFrontDirection = CARDINAL_DIRECTIONS.includes(requestedFrontDirection)
        ? requestedFrontDirection
        : form.frontDirection;

      if (requestedFrontDirection && CARDINAL_DIRECTIONS.includes(requestedFrontDirection)) {
        setForm((prev) => ({ ...prev, frontDirection: requestedFrontDirection }));
      }

      if (payload.boundaries || payload.plot.front) {
        setBoundaries((prev) =>
          normalizeBoundaries(payload.boundaries ?? prev, importedFrontDirection),
        );
      }

      const importedRooms = payload.layout.map((room) => ({
        ...room,
        roomType: room.type || room.roomType,
        label: room.label || room.type || room.roomType,
        doors: room.doors || [],
        windows: room.windows || [],
      }));

      setInitialRooms(importedRooms);
      setRoomsDraft(importedRooms);
      setImportJson("");
      setShowImport(false);
      clearDesignLink();
      setCurrentDesignUpdatedAt("");
      setDesignName(createDefaultDesignName());
      setSaveFeedback("Imported layout loaded. Save it as a new design when ready.");
    } catch (importError) {
      setError(`Import Error: ${importError.message}`);
    }
  };

  const handleCopyLayoutSchema = async () => {
    const payload = {
      plot: {
        width: plot.plotWidth,
        height: plot.plotHeight,
        gaj: plot.plotGaj,
        shape: plot.plotShape,
        front: form.frontDirection,
      },
      boundaries: normalizeBoundaries(boundaries, form.frontDirection),
      layout: roomsDraft.map((room) => ({
        id: room.id,
        type: room.type || room.roomType,
        zone: room.zone || room.roomType,
        x: room.x,
        y: room.y,
        width: room.width,
        height: room.height,
      })),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setSchemaCopyFeedback("Copied!");
      setTimeout(() => setSchemaCopyFeedback(""), 1800);
    } catch {
      setSchemaCopyFeedback("Failed");
      setTimeout(() => setSchemaCopyFeedback(""), 1800);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    requestLayout({
      plotGaj: Math.max(100, Math.min(400, Number(form.plotGaj) || initialForm.plotGaj)),
      plotShape: form.plotShape,
      dwellingType: form.dwellingType,
      bedrooms: Math.max(1, Math.min(6, Number(form.bedrooms) || initialForm.bedrooms)),
      bathrooms: Math.max(1, Math.min(4, Number(form.bathrooms) || initialForm.bathrooms)),
      frontDirection: form.frontDirection,
      engine: form.engine,
    });
  };

  useEffect(() => {
    if (hasAutoGenerated.current) return;
    hasAutoGenerated.current = true;

    requestLayout({
      plotGaj: initialForm.plotGaj,
      plotShape: initialForm.plotShape,
      dwellingType: initialForm.dwellingType,
      bedrooms: initialForm.bedrooms,
      bathrooms: initialForm.bathrooms,
      frontDirection: initialForm.frontDirection,
      engine: initialForm.engine,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("floorplan-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!isProfileMenuOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isProfileMenuOpen]);

  const displayName = authUser?.name || "Profile";
  const avatarInitial = String(displayName).trim().charAt(0).toUpperCase() || "P";

  return (
    <div className={`app-frame theme-${themeMode}`}>
      <div className="app-utility-row">
        <div className="app-utility-cluster">
          <div className="app-nav-identity">
            <h2>ArchFlow</h2>
            <span>Layout Generator</span>
          </div>

          <div className="workspace-view-toggle app-nav-toggle" role="group" aria-label="Workspace view">
            <button
              type="button"
              className={`view-toggle-btn ${activeView === "editor" ? "active" : ""}`}
              onClick={() => setActiveView("editor")}
            >
              Editor
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${activeView === "designs" ? "active" : ""}`}
              onClick={() => setActiveView("designs")}
            >
              My Designs
            </button>
          </div>

          <div className="app-utility-controls">
            <button
              type="button"
              className={`theme-icon-toggle ${themeMode === "dark" ? "dark" : "light"}`}
              onClick={() => setThemeMode((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
            >
              <span className="theme-icon-sun" aria-hidden="true">☀</span>
              <span className="theme-icon-moon" aria-hidden="true">☾</span>
              <span className="theme-icon-thumb" aria-hidden="true" />
            </button>

            <div className="app-profile" ref={profileMenuRef}>
              <button
                type="button"
                className="app-profile-trigger"
                onClick={() => setIsProfileMenuOpen((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
              >
                <span className="app-profile-avatar" aria-hidden="true">{avatarInitial}</span>
                <span className="app-profile-name">{displayName}</span>
                <span className="app-profile-caret" aria-hidden="true" />
              </button>

              {isProfileMenuOpen ? (
                <div className="app-profile-menu" role="menu">
                  <button
                    type="button"
                    className="app-profile-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      if (typeof onAuthExpired === "function") {
                        onAuthExpired();
                      }
                    }}
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <main className={`app-shell theme-${themeMode}`}>
        <section className="controls sidebar-shell">
          <div className="sidebar-top-zone">
            <form id="layout-generator-form" onSubmit={handleSubmit} className="sidebar-form">
              <div className="sidebar-card">
                <h3 className="sidebar-section-title">Plot Details</h3>
                <label>
                  Plot Size (Gaj)
                  <input
                    max="400"
                    min="100"
                    name="plotGaj"
                    onChange={handleChange}
                    step="1"
                    type="number"
                    value={form.plotGaj}
                  />
                </label>

                <label>
                  Plot Shape
                  <CustomSelect
                    name="plotShape"
                    value={form.plotShape}
                    onChange={handleSelectChange}
                    options={[
                      { value: "square", label: "Square" },
                      { value: "rectangle", label: "Rectangle" },
                      { value: "deep-rectangle", label: "Deep Rectangle" },
                    ]}
                  />
                </label>

                <label>
                  Front Direction
                  <CustomSelect
                    name="frontDirection"
                    value={form.frontDirection}
                    onChange={handleSelectChange}
                    options={[
                      { value: "north", label: "North" },
                      { value: "east", label: "East" },
                      { value: "south", label: "South" },
                      { value: "west", label: "West" },
                    ]}
                  />
                </label>
              </div>

              <div className="sidebar-card">
                <h3 className="sidebar-section-title">Rooms</h3>
                <label>
                  Dwelling Type
                  <CustomSelect
                    name="dwellingType"
                    value={form.dwellingType}
                    onChange={handleSelectChange}
                    options={[
                      { value: "house", label: "House" },
                      { value: "flat", label: "Flat / Building Floor" },
                    ]}
                  />
                </label>

                <label>
                  Bedrooms
                  <input
                    max="6"
                    min="1"
                    name="bedrooms"
                    onChange={handleChange}
                    step="1"
                    type="number"
                    value={form.bedrooms}
                  />
                </label>

                <label>
                  Bathrooms
                  <input
                    max="4"
                    min="1"
                    name="bathrooms"
                    onChange={handleChange}
                    step="1"
                    type="number"
                    value={form.bathrooms}
                  />
                </label>
              </div>

              <div className="sidebar-card">
                <h3 className="sidebar-section-title">Setbacks & Boundaries</h3>
                <div className="boundary-toggles">
                  <p className="boundary-toggles-hint">Mark sides as blocked by neighbors or open for ventilation</p>
                  <p className="boundary-front-note">
                    Front side is controlled by Front Direction and remains locked.
                  </p>
                  {CARDINAL_DIRECTIONS.map((dir) => (
                    boundaries[dir] !== "front" && (
                      <button
                        key={dir}
                        type="button"
                        className={`boundary-toggle-btn ${boundaries[dir]}`}
                        onClick={() => handleBoundaryToggle(dir)}
                      >
                        <span className="dir-label">{dir.charAt(0).toUpperCase() + dir.slice(1)} Side:</span>
                        <span className={`status-label ${boundaries[dir]}`}>
                          {boundaries[dir] === "covered" ? "Covered" : "Open"}
                        </span>
                      </button>
                    )
                  ))}
                </div>
              </div>

              <div className="sidebar-card engine-toggle">
                <h3 className="sidebar-section-title">Engine</h3>
                <label className="engine-toggle-label">
                  <strong>Layout Engine</strong>
                  <CustomSelect
                    name="engine"
                    value={form.engine}
                    onChange={handleSelectChange}
                    options={[
                      { value: "v1", label: "Basic Blueprint Engine (Legacy)" },
                      { value: "v3", label: "Zoning Layout Engine (New)" },
                    ]}
                  />
                </label>
              </div>

              <button
                type="submit"
                className="sidebar-primary-cta"
                disabled={isLoading}
              >
                {isLoading ? "Generating..." : "Generate Layout"}
              </button>
            </form>

            <div className="import-container sidebar-card sidebar-secondary-card">
              <h3 className="sidebar-section-title">Import / Export</h3>
              <button
                type="button"
                className="sidebar-secondary-btn"
                onClick={() => setShowImport(!showImport)}
              >
                {showImport ? "Hide Import" : "Import Layout from JSON"}
              </button>

              <button
                type="button"
                className={`sidebar-secondary-btn ${schemaCopyFeedback ? "success" : ""}`}
                onClick={handleCopyLayoutSchema}
              >
                {schemaCopyFeedback || "Copy Layout Schema"}
              </button>

              {showImport ? (
                <div className="import-content">
                  <textarea
                    className="import-textarea"
                    placeholder="Paste your layout JSON here..."
                    value={importJson}
                    onChange={(event) => setImportJson(event.target.value)}
                    rows={8}
                  />
                  <button
                    type="button"
                    className="sidebar-secondary-btn"
                    onClick={handleImportLayout}
                  >
                    Apply Imported Layout
                  </button>
                </div>
              ) : null}
            </div>

            <div className="sidebar-card design-save-card">
              <label>
                Design Name
                <input
                  type="text"
                  value={designName}
                  onChange={(event) => setDesignName(event.target.value)}
                  placeholder="Enter a design name"
                  maxLength={120}
                />
              </label>

              <div className="design-save-actions">
                <button
                  type="button"
                  className="sidebar-section-primary-btn"
                  onClick={handleSaveDesign}
                  disabled={isSavingDesign || isLoading}
                >
                  {isSavingDesign ? "Saving..." : currentDesignId ? "Update Design" : "Save Design"}
                </button>
                <button
                  type="button"
                  className="sidebar-secondary-btn"
                  onClick={handleNewDesign}
                >
                  New Design
                </button>
              </div>

              <div className="design-save-meta">
                <p>User: {authUser?.name || "Unknown"}</p>
                <p>Mode: {currentDesignId ? "Editing saved design" : "New unsaved design"}</p>
                <p>
                  Last saved: {currentDesignUpdatedAt ? new Date(currentDesignUpdatedAt).toLocaleString() : "Not saved yet"}
                </p>
              </div>

              {saveFeedback ? <p className="message design-save-success">{saveFeedback}</p> : null}
              {designError ? <p className="message error">{designError}</p> : null}
            </div>

            {isLoading ? <p className="message">Generating initial layout...</p> : null}
            {error ? <p className="message error">{error}</p> : null}

            <div className="spec-list sidebar-card sidebar-secondary-card sidebar-meta-card">
              <h3 className="sidebar-section-title">Current Plot</h3>
              <p>Current plot: {plot.plotGaj ?? form.plotGaj} Gaj</p>
              <p>Shape: {plot.plotShape ?? form.plotShape}</p>
              <p>
                Footprint: {plot.plotWidth.toFixed(2)}ft x {plot.plotHeight.toFixed(2)}ft
              </p>
              <p>Drag rooms freely and use Save Design to persist updates.</p>
            </div>
          </div>

        </section>

        <section className="layout-panel">
          {activeView === "designs" ? (
            <DesignDashboard
              designs={savedDesigns}
              isLoading={isDesignsLoading}
              error={designError}
              onRefresh={() => loadSavedDesigns()}
              onOpenDesign={handleOpenDesign}
              onDeleteDesign={handleDeleteDesign}
              activeDesignId={currentDesignId}
              deletingDesignId={isDeletingDesignId}
              currentUserName={authUser?.name}
            />
          ) : (
            <GridFloorPlanEditor
              plotHeight={plot.plotHeight}
              plotWidth={plot.plotWidth}
              initialRooms={initialRooms}
              frontDirection={form.frontDirection}
              dwellingType={form.dwellingType}
              boundaries={boundaries}
              themeMode={themeMode}
              onRoomsChange={handleEditorRoomsChange}
            />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
