/* global maplibregl */

"use strict";

/*
 * Renders the index map of the places holding subsidiary projects or datasets. Places are drawn softly, and highlighted
 * while the pointer is over them, or over their section in a list on the page marked with `data-map-id`, which is in
 * turn marked as hovered while the pointer is over the place on the map. Hovering a place shows its name and the
 * projects within it. Clicking a place holding a single project browses to that project's site; otherwise, or on
 * devices without hover, a click shows a popup linking to each project in the place.
 *
 * Places may overlap - a small place may lie within a larger one. Larger places are drawn beneath smaller ones, and
 * where places overlap, the pointer selects the smallest of them.
 */

const imerssProjectMapDefaults = {
    // Overview of the Salish Sea as [[west, south], [east, north]]
    bounds: [[-125.3, 47.0], [-122.0, 50.3]],
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    colour: "#FDF2CE"
};

// Paint values for places at rest and while highlighted - soft by default, so that the map reads as a quiet backdrop
const imerssPlacePaint = {
    fillOpacity: [0.07, 0.3],
    lineOpacity: [0.5, 1],
    lineWidth: [1, 2.25],
    glowOpacity: [0, 0.45]
};

/**
 * Build a paint expression choosing between a value for places at rest and one for a highlighted place.
 * @param {Number[]} values - The values at rest and while highlighted.
 * @return {Array} A MapLibre expression selecting between them by the feature's "hover" state.
 */
const imerssHoverValue = function (values) {
    return ["case", ["boolean", ["feature-state", "hover"], false], values[1], values[0]];
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
 * Merge the boundaries of all places into a single FeatureCollection, tagging each feature with its place's index and
 * the area of its place. Features are ordered from largest to smallest so that smaller places are drawn above any
 * larger ones they overlap.
 * @param {Object[]} places - Place records, each with a `boundary` member holding a GeoJSON FeatureCollection.
 * @return {Object} A GeoJSON FeatureCollection whose features each have an `id` equal to their place's index.
 */
const imerssPlaceFeatures = function (places) {
    const features = places.flatMap((place, index) => {
        const area = place.boundary.features.reduce((total, feature) => total + imerssGeometryArea(feature.geometry), 0);
        return place.boundary.features.map(feature => ({
            type: "Feature",
            id: index,
            properties: {placeIndex: index, area},
            geometry: feature.geometry
        }));
    });
    features.sort((a, b) => b.properties.area - a.properties.area);
    return {type: "FeatureCollection", features};
};

/**
 * Find the place under a point on the map, choosing the smallest where places overlap.
 * @param {maplibregl.Map} map - The map holding the "place-fill" layer.
 * @param {maplibregl.Point} point - The point in screen coordinates.
 * @return {Number|null} The index of the place under the point, or null if there is none.
 */
const imerssPlaceAt = function (map, point) {
    const features = map.queryRenderedFeatures(point, {layers: ["place-fill"]});
    const smallest = features.reduce((best, feature) => !best || feature.properties.area < best.properties.area ? feature : best, null);
    return smallest ? smallest.properties.placeIndex : null;
};

/**
 * Build the HTML shown in a popup for a place, naming it and listing the projects within it.
 * @param {Object} place - A place record with members `name` and `items`, each item having `titleHtml` and `siteUrl`.
 * @param {Boolean} withLinks - Whether to link each project to its site.
 * @return {String} The popup's HTML.
 */
const imerssPlacePopupHtml = function (place, withLinks) {
    const items = place.items.map(item => "<li>" + (withLinks ? "<a href=\"" + item.siteUrl + "\">" + item.titleHtml + "</a>" :
        item.titleHtml) + "</li>").join("");
    return "<h1>" + place.name + "</h1><ul class=\"imerss-place-popup-items\">" + items + "</ul>";
};

/**
 * Create the place map within a container.
 * @param {HTMLElement} container - The element to render the map into.
 * @param {Object[]} places - Place records as rendered by the `project-map.html` partial.
 * @param {Object} [options] - Options overriding `imerssProjectMapDefaults`.
 * @return {maplibregl.Map} The created map.
 */
const imerssProjectMap = function (container, places, options) {
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

    // Follows the pointer while hovering, so it must not intercept the pointer, or the map would see it leave the place
    const hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: "320px",
        offset: 14,
        className: "imerss-project-popup imerss-project-popup-hover"
    });
    // Opened by a click, holding links to each project in the place
    const linkPopup = new maplibregl.Popup({
        closeOnClick: true,
        maxWidth: "320px",
        offset: 14,
        className: "imerss-project-popup"
    });
    const listSections = [...document.querySelectorAll("[data-map-id]")];
    let hoveredIndex = null;

    /**
     * Highlight a place on the map and its section in any list on the page, or clear the highlight.
     * @param {Number|null} index - The index of the place to highlight, or null to clear any highlight.
     */
    const setHovered = function (index) {
        if (hoveredIndex !== null) {
            map.setFeatureState({source: "places", id: hoveredIndex}, {hover: false});
        }
        hoveredIndex = index;
        if (index !== null) {
            map.setFeatureState({source: "places", id: index}, {hover: true});
        }
        const id = index === null ? null : places[index].id;
        listSections.forEach(section => section.classList.toggle("imerss-map-hovered", section.dataset.mapId === id));
    };

    map.on("load", () => {
        map.addSource("places", {type: "geojson", data: imerssPlaceFeatures(places)});
        map.addLayer({
            id: "place-fill",
            type: "fill",
            source: "places",
            paint: {
                "fill-color": opts.colour,
                "fill-opacity": imerssHoverValue(imerssPlacePaint.fillOpacity)
            }
        });
        // A soft glow around a highlighted place
        map.addLayer({
            id: "place-glow",
            type: "line",
            source: "places",
            paint: {
                "line-color": opts.colour,
                "line-width": 8,
                "line-blur": 6,
                "line-opacity": imerssHoverValue(imerssPlacePaint.glowOpacity)
            }
        });
        map.addLayer({
            id: "place-outline",
            type: "line",
            source: "places",
            paint: {
                "line-color": opts.colour,
                "line-width": imerssHoverValue(imerssPlacePaint.lineWidth),
                "line-opacity": imerssHoverValue(imerssPlacePaint.lineOpacity)
            }
        });

        map.on("mousemove", "place-fill", e => {
            if (canHover) {
                const index = imerssPlaceAt(map, e.point);
                map.getCanvas().style.cursor = "pointer";
                if (index !== hoveredIndex) {
                    setHovered(index);
                    hoverPopup.setHTML(imerssPlacePopupHtml(places[index], false));
                }
                if (!linkPopup.isOpen()) {
                    hoverPopup.setLngLat(e.lngLat).addTo(map);
                }
            }
        });
        map.on("mouseleave", "place-fill", () => {
            if (canHover) {
                map.getCanvas().style.cursor = "";
                hoverPopup.remove();
                setHovered(null);
            }
        });
        map.on("click", e => {
            const index = imerssPlaceAt(map, e.point);
            if (index !== null) {
                const place = places[index];
                if (canHover && place.items.length === 1) {
                    window.location.href = place.items[0].siteUrl;
                } else {
                    hoverPopup.remove();
                    setHovered(index);
                    linkPopup.setLngLat(e.lngLat).setHTML(imerssPlacePopupHtml(place, true)).addTo(map);
                }
            } else if (!canHover) {
                setHovered(null);
            }
        });

        // Highlight a place while the pointer is over its section in a list on the page
        listSections.forEach(section => {
            const index = places.findIndex(place => place.id === section.dataset.mapId);
            if (index !== -1) {
                section.addEventListener("mouseenter", () => {
                    linkPopup.remove();
                    setHovered(index);
                });
                section.addEventListener("mouseleave", () => setHovered(null));
            }
        });
    });
    return map;
};

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".imerss-project-map").forEach(container => {
        const dataElement = container.parentElement.querySelector(".imerss-project-map-data");
        const places = JSON.parse(dataElement?.textContent || "[]");
        const bounds = JSON.parse(container.dataset.bounds || "null");
        imerssProjectMap(container, places, bounds ? {bounds} : {});
    });
});
