/* global maplibregl */

"use strict";

/*
 * Renders the index map of subsidiary project boundaries. Hovering a project shows its description, and clicking it
 * browses to the project's site. On devices without hover, a tap shows the description with a link to the site.
 * Hovering an item in a list on the page marked with `data-map-id` highlights that project's boundary.
 *
 * Boundaries may overlap - a small project area may lie within a larger one. Larger boundaries are drawn beneath
 * smaller ones, and where boundaries overlap, the pointer selects the smallest of them.
 */

const imerssProjectMapDefaults = {
    // Overview of the Salish Sea as [[west, south], [east, north]]
    bounds: [[-125.3, 47.0], [-122.0, 50.3]],
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    colour: "#FDF2CE"
};

/**
 * Compute the area of a ring by the shoelace formula, in squared degrees, which suffices to compare boundaries' sizes.
 * @param {Number[][]} ring - The ring's coordinates as [longitude, latitude] pairs.
 * @return {Number} The ring's area.
 */
const imerssRingArea = function (ring) {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; ++i) {
        sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(sum) / 2;
};

/**
 * Compute the approximate area of a Polygon or MultiPolygon geometry, discounting its holes.
 * @param {Object} geometry - A GeoJSON geometry.
 * @return {Number} The geometry's area in squared degrees, or 0 if it is not polygonal.
 */
const imerssGeometryArea = function (geometry) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] :
        geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    return polygons.reduce((total, rings) => total + rings.reduce((polygonArea, ring, i) =>
        polygonArea + (i === 0 ? 1 : -1) * imerssRingArea(ring), 0), 0);
};

/**
 * Merge the boundaries of all projects into a single FeatureCollection, tagging each feature with its project's index
 * and the area of its project's boundary. Features are ordered from largest to smallest so that smaller boundaries are
 * drawn above any larger ones they overlap.
 * @param {Object[]} projects - Project records, each with a `boundary` member holding a GeoJSON FeatureCollection.
 * @return {Object} A GeoJSON FeatureCollection whose features each have an `id` equal to their project's index.
 */
const imerssProjectFeatures = function (projects) {
    const features = projects.flatMap((project, index) => {
        const area = project.boundary.features.reduce((total, feature) => total + imerssGeometryArea(feature.geometry), 0);
        return project.boundary.features.map(feature => ({
            type: "Feature",
            id: index,
            properties: {projectIndex: index, area},
            geometry: feature.geometry
        }));
    });
    features.sort((a, b) => b.properties.area - a.properties.area);
    return {type: "FeatureCollection", features};
};

/**
 * Find the project whose boundary lies under a point on the map, choosing the smallest where boundaries overlap.
 * @param {maplibregl.Map} map - The map holding the "project-fill" layer.
 * @param {maplibregl.Point} point - The point in screen coordinates.
 * @return {Number|null} The index of the project under the point, or null if there is none.
 */
const imerssProjectAt = function (map, point) {
    const features = map.queryRenderedFeatures(point, {layers: ["project-fill"]});
    const smallest = features.reduce((best, feature) => !best || feature.properties.area < best.properties.area ? feature : best, null);
    return smallest ? smallest.properties.projectIndex : null;
};

/**
 * Build the HTML shown in the popup for a project.
 * @param {Object} project - A project record with members `descriptionHtml`, `siteUrl` and `linkText`.
 * @param {Boolean} withLink - Whether to include an explicit link to the project's site.
 * @return {String} The popup's HTML.
 */
const imerssProjectPopupHtml = function (project, withLink) {
    const link = withLink ? "<p class=\"imerss-project-popup-link\"><a href=\"" + project.siteUrl + "\">" + project.linkText + " &rarr;</a></p>" : "";
    return project.descriptionHtml + link;
};

/**
 * Create the project map within a container.
 * @param {HTMLElement} container - The element to render the map into.
 * @param {Object[]} projects - Project records as rendered by the `project-map.html` partial.
 * @param {Object} [options] - Options overriding `imerssProjectMapDefaults`.
 * @return {maplibregl.Map} The created map.
 */
const imerssProjectMap = function (container, projects, options) {
    const opts = {...imerssProjectMapDefaults, ...options};
    const canHover = window.matchMedia("(hover: hover)").matches;
    const map = new maplibregl.Map({
        container,
        bounds: opts.bounds,
        style: {
            version: 8,
            sources: {
                basemap: {
                    type: "raster",
                    tiles: [opts.tiles],
                    tileSize: 256,
                    attribution: opts.attribution
                }
            },
            layers: [{id: "basemap", type: "raster", source: "basemap"}]
        }
    });
    map.addControl(new maplibregl.NavigationControl({showCompass: false}), "top-right");

    const popup = new maplibregl.Popup({
        closeButton: !canHover,
        closeOnClick: false,
        maxWidth: "340px",
        offset: 14,
        // When hovering, the popup must not intercept the pointer, or the map would see it leave the project
        className: "imerss-project-popup" + (canHover ? " imerss-project-popup-hover" : "")
    });
    let hoveredIndex = null;

    /**
     * Highlight a project and show its popup, or clear the highlight and popup.
     * @param {Number|null} index - The index of the project to highlight, or null to clear any highlight.
     * @param {maplibregl.LngLat} [lngLat] - The location at which to show the popup, or none to highlight without one.
     */
    const setHovered = function (index, lngLat) {
        if (hoveredIndex !== null) {
            map.setFeatureState({source: "projects", id: hoveredIndex}, {hover: false});
        }
        hoveredIndex = index;
        if (index !== null) {
            map.setFeatureState({source: "projects", id: index}, {hover: true});
        }
        if (index !== null && lngLat) {
            popup.setLngLat(lngLat);
            if (!popup.isOpen()) {
                popup.setHTML(imerssProjectPopupHtml(projects[index], !canHover)).addTo(map);
            }
        } else {
            popup.remove();
        }
    };

    map.on("load", () => {
        map.addSource("projects", {type: "geojson", data: imerssProjectFeatures(projects)});
        map.addLayer({
            id: "project-fill",
            type: "fill",
            source: "projects",
            paint: {
                "fill-color": opts.colour,
                "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.45, 0.2]
            }
        });
        map.addLayer({
            id: "project-outline",
            type: "line",
            source: "projects",
            paint: {
                "line-color": opts.colour,
                "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 3, 1.5]
            }
        });

        map.on("mousemove", "project-fill", e => {
            if (canHover) {
                const index = imerssProjectAt(map, e.point);
                if (index !== hoveredIndex) {
                    popup.remove();
                }
                map.getCanvas().style.cursor = "pointer";
                setHovered(index, e.lngLat);
            }
        });
        map.on("mouseleave", "project-fill", () => {
            if (canHover) {
                map.getCanvas().style.cursor = "";
                setHovered(null);
            }
        });
        map.on("click", e => {
            const index = imerssProjectAt(map, e.point);
            if (index !== null) {
                if (canHover) {
                    window.location.href = projects[index].siteUrl;
                } else {
                    popup.remove();
                    setHovered(index, e.lngLat);
                }
            } else {
                setHovered(null);
            }
        });

        // Highlight a project's boundary while the pointer is over its entry in a list on the page
        document.querySelectorAll("[data-map-id]").forEach(item => {
            const index = projects.findIndex(project => project.id === item.dataset.mapId);
            if (index !== -1) {
                item.addEventListener("mouseenter", () => {
                    popup.remove();
                    setHovered(index);
                });
                item.addEventListener("mouseleave", () => setHovered(null));
            }
        });
    });
    return map;
};

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".imerss-project-map").forEach(container => {
        const dataElement = container.parentElement.querySelector(".imerss-project-map-data");
        const projects = JSON.parse(dataElement?.textContent || "[]");
        const bounds = JSON.parse(container.dataset.bounds || "null");
        imerssProjectMap(container, projects, bounds ? {bounds} : {});
    });
});
