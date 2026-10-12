/* global maplibregl */

"use strict";

/*
 * Renders the index map of subsidiary project boundaries. Hovering a project shows its description, and clicking it
 * browses to the project's site. On devices without hover, a tap shows the description with a link to the site.
 */

const imerssProjectMapDefaults = {
    // Overview of the Salish Sea as [[west, south], [east, north]]
    bounds: [[-125.3, 47.0], [-122.0, 50.3]],
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    colour: "#FDF2CE"
};

/**
 * Merge the boundaries of all projects into a single FeatureCollection, tagging each feature with its project's index.
 * @param {Object[]} projects - Project records, each with a `boundary` member holding a GeoJSON FeatureCollection.
 * @return {Object} A GeoJSON FeatureCollection whose features each have an `id` equal to their project's index.
 */
const imerssProjectFeatures = function (projects) {
    const features = projects.flatMap((project, index) => project.boundary.features.map(feature => ({
        type: "Feature",
        id: index,
        properties: {projectIndex: index},
        geometry: feature.geometry
    })));
    return {type: "FeatureCollection", features};
};

/**
 * Build the HTML shown in the popup for a project.
 * @param {Object} project - A project record with members `descriptionHtml` and `siteUrl`.
 * @param {Boolean} withLink - Whether to include an explicit link to the project's site.
 * @return {String} The popup's HTML.
 */
const imerssProjectPopupHtml = function (project, withLink) {
    const link = withLink ? "<p class=\"imerss-project-popup-link\"><a href=\"" + project.siteUrl + "\">Visit project site &rarr;</a></p>" : "";
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
     * @param {maplibregl.LngLat} [lngLat] - The location at which to show the popup.
     */
    const setHovered = function (index, lngLat) {
        if (hoveredIndex !== null) {
            map.setFeatureState({source: "projects", id: hoveredIndex}, {hover: false});
        }
        hoveredIndex = index;
        if (index !== null) {
            map.setFeatureState({source: "projects", id: index}, {hover: true});
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
                const index = e.features[0].properties.projectIndex;
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
            const features = map.queryRenderedFeatures(e.point, {layers: ["project-fill"]});
            if (features.length > 0) {
                const index = features[0].properties.projectIndex;
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
