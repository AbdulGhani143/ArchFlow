function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDesignSummary(design) {
  const designData = design?.designData ?? {};
  const plot = designData.plot ?? {};
  const form = designData.form ?? {};
  const layout = Array.isArray(designData.layout) ? designData.layout : [];

  const normalizedLayoutTypes = layout
    .map((room) => String(room?.type || room?.roomType || "").toLowerCase())
    .filter(Boolean);

  const derivedBedroomCount = normalizedLayoutTypes.filter(
    (type) => type.includes("bedroom") && !type.includes("bath"),
  ).length;

  const derivedBathroomCount = normalizedLayoutTypes.filter(
    (type) => type.includes("bath") || type.includes("bathroom") || type.includes("toilet"),
  ).length;

  const bedroomCount = Number.isFinite(Number(form.bedrooms))
    ? Number(form.bedrooms)
    : derivedBedroomCount;

  const bathroomCount = Number.isFinite(Number(form.bathrooms))
    ? Number(form.bathrooms)
    : derivedBathroomCount;

  const previewRoomNames = layout
    .map((room) => room.label || room.type || room.id)
    .filter(Boolean)
    .filter((name) => {
      const normalizedName = String(name).toLowerCase();
      return !normalizedName.includes("shaft") && !normalizedName.includes("attached bath");
    })
    .slice(0, 3)
    .join(" • ");

  return {
    dwellingLabel:
      bedroomCount > 0 && bathroomCount > 0
        ? `${bedroomCount} Bed • ${bathroomCount} Bath`
        : "Layout details unavailable",
    plotLabel:
      Number.isFinite(plot.width) && Number.isFinite(plot.height)
        ? `${plot.width}ft x ${plot.height}ft`
        : "Plot not available",
    previewRoomNames: previewRoomNames || "No room preview yet",
  };
}

function DesignDashboard({
  designs,
  isLoading,
  error,
  onRefresh,
  onOpenDesign,
  onDeleteDesign,
  activeDesignId,
  deletingDesignId,
  currentUserName,
}) {
  const safeDesigns = Array.isArray(designs) ? designs : [];

  return (
    <div className="design-dashboard">
      <div className="design-dashboard-header">
        <div>
          <p className="design-dashboard-eyebrow">Saved Designs</p>
          <h2>{currentUserName ? `${currentUserName}'s Dashboard` : "Design Dashboard"}</h2>
          <p className="design-dashboard-subtitle">
            Open any design to continue editing and save updates.
          </p>
        </div>
        <button type="button" className="design-dashboard-refresh-btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {isLoading ? <p className="design-dashboard-status">Loading your saved designs...</p> : null}
      {error ? <p className="design-dashboard-error">{error}</p> : null}

      {!isLoading && safeDesigns.length === 0 ? (
        <div className="design-dashboard-empty">
          <h3>No saved designs yet</h3>
          <p>Create a layout in Editor and click Save Design to add it here.</p>
        </div>
      ) : null}

      {safeDesigns.length > 0 ? (
        <div className="design-grid" role="list" aria-label="Saved designs">
          {safeDesigns.map((design) => {
            const summary = getDesignSummary(design);
            const isActive = Boolean(activeDesignId) && String(activeDesignId) === String(design.id);

            return (
              <article key={design.id} className={`design-card ${isActive ? "active" : ""}`} role="listitem">
                <div className="design-card-title-row">
                  <h3 title={design.name}>{design.name}</h3>
                  {isActive ? <span className="design-card-active-chip">Active</span> : null}
                </div>

                <div className="design-card-summary">
                  <p className="design-card-rooms">{summary.previewRoomNames}</p>
                  <div className="design-card-preview" aria-hidden="true">
                    <p>{summary.plotLabel}</p>
                    <p>{summary.dwellingLabel}</p>
                  </div>
                </div>

                <p className="design-card-updated">Last updated: {formatDateTime(design.updatedAt)}</p>

                <div className="design-card-actions">
                  <button type="button" className="design-card-open-btn" onClick={() => onOpenDesign(design)}>
                    Open & Edit
                  </button>
                  <button
                    type="button"
                    className="design-card-delete-btn"
                    onClick={() => onDeleteDesign?.(design)}
                    disabled={!onDeleteDesign || String(deletingDesignId) === String(design.id)}
                  >
                    {String(deletingDesignId) === String(design.id) ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default DesignDashboard;
