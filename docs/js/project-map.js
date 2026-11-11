/* global maplibregl */

"use strict";

/*
 * The map of places beside the list of projects or datasets (see static/js/project-list.js). Places highlight while
 * hovered here or in the list, and a place opened in the list is brought into view, with any records of a dataset hovered
 * or expanded there drawn as points. Clicking a place opens it in the list. Where places overlap, the smallest is chosen.
 */

const imerssProjectMapDefaults = {
    // Overview of the Salish Sea as [[west, south], [east, north]]
    bounds: [[-125.3, 47.0], [-122.0, 50.3]],
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    colour: "#FDF2CE"
};

const imerssOccurrencePaint = {
    colour: "#F2A541",
    stroke: "#184E62"
};

// At rest and while highlighted
const imerssPlacePaint = {
    fillOpacity: [0, 0.12],
    lineOpacity: [0, 1],
    lineWidth: [1, 2.25],
    glowOpacity: [0, 0.45]
};

/**
 * Build a paint expression choosing between a value for places at rest and one for a highlighted place.
 * @param {Number[]} values - The values at rest and while highlighted.
 * @return {Array} A MapLibre expression selecting between them by the feature's "hover" and "selected" states.
 */
const imerssHoverValue = function (values) {
    return ["case", ["any", ["boolean", ["feature-state", "hover"], false], ["boolean", ["feature-state", "selected"], false]],
        values[1], values[0]];
};

/**
 * Compute the bounds of a GeoJSON FeatureCollection.
 * @param {Object} collection - A GeoJSON FeatureCollection of polygons or points.
 * @return {Number[][]|null} Its bounds as [[west, south], [east, north]], or null if it holds no coordinates.
 */
const imerssBounds = function (collection) {
    const bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
    const visit = coords => {
        if (typeof coords[0] === "number") {
            bounds[0] = [Math.min(bounds[0][0], coords[0]), Math.min(bounds[0][1], coords[1])];
            bounds[1] = [Math.max(bounds[1][0], coords[0]), Math.max(bounds[1][1], coords[1])];
        } else {
            coords.forEach(visit);
        }
    };
    collection.features.forEach(feature => visit(feature.geometry.coordinates));
    return isFinite(bounds[0][0]) ? bounds : null;
};

/**
 * Escape text for inclusion in HTML.
 * @param {String} text - The text.
 * @return {String} The escaped text.
 */
const imerssEscape = text => String(text).replace(/[&<>"']/g, c => "&#" + c.charCodeAt(0) + ";");

const imerssOccurrenceFields = [
    ["locality", "Locality"],
    ["habitat", "Habitat"],
    ["organismQuantity", "Abundance"],
    ["occurrenceRemarks", "Remarks"],
    ["recordedBy", "Recorded by"],
    ["fieldNotes", "Source"],
    ["occurrenceID", "Record"]
];

/**
 * Build the HTML shown in the popup for a record drawn on the map.
 * @param {Object} properties - The record's properties, as written by scripts/build-occurrences.js.
 * @return {String} The popup's HTML.
 */
const imerssOccurrencePopupHtml = function (properties) {
    if (properties.records !== undefined) {
        const plural = (n, word) => n.toLocaleString() + " " + word + (n === 1 ? "" : "s");
        const years = properties.firstYear ? properties.firstYear === properties.lastYear ? String(properties.firstYear) :
            properties.firstYear + "–" + properties.lastYear : "";
        return "<h1>" + plural(properties.records, "record") + "</h1><p>" + plural(properties.taxa, "taxon").replace(/taxons$/, "taxa") +
            (years ? " · " + years : "") + "</p>";
    }
    const name = properties.scientificName || properties.verbatimIdentification || "Unidentified";
    const verbatim = properties.verbatimIdentification && properties.verbatimIdentification !== name &&
        !name.startsWith(properties.verbatimIdentification + " ") ? " <span class=\"imerss-occurrence-verbatim\">(recorded as " +
        imerssEscape(properties.verbatimIdentification) + ")</span>" : "";
    const rows = imerssOccurrenceFields.filter(([field]) => properties[field]).map(([field, label]) => {
        const value = field === "organismQuantity" && properties.organismQuantityType ?
            properties.organismQuantity + " " + properties.organismQuantityType : properties[field];
        return "<dt>" + label + "</dt><dd>" + imerssEscape(String(value).replace(/ \| /g, ", ")) + "</dd>";
    }).join("");
    return "<h1><em>" + imerssEscape(name) + "</em>" + verbatim + "</h1>" +
        (properties.eventDate ? "<p>" + imerssEscape(properties.eventDate) + "</p>" : "") +
        "<dl class=\"imerss-occurrence-fields\">" + rows + "</dl>";
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
 * Build the HTML shown in the popup for a place, naming it and listing the projects within it.
 * @param {Object} place - A place record with members `name` and `items`, each item having `titleHtml`.
 * @return {String} The popup's HTML.
 */
const imerssPlacePopupHtml = function (place) {
    const items = place.items.map(item => "<li>" + item.titleHtml + "</li>").join("");
    return "<h1>" + place.name + "</h1><ul class=\"imerss-place-popup-items\">" + items + "</ul>";
};

/**
 * Open a place in the list of places - on this page if it holds the list, or else on the page that does.
 * @param {String} id - The place's id.
 * @param {String} listUrl - The URL of the page listing the places.
 */
const imerssOpenPlaceInList = function (id, listUrl) {
    if (document.querySelector(".imerss-place[data-map-id=\"" + id + "\"]")) {
        document.dispatchEvent(new CustomEvent("imerss-open-place", {detail: {id}}));
    } else if (listUrl) {
        window.location.href = listUrl + "#imerss-place-" + encodeURIComponent(id);
    }
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
    const listSections = [...document.querySelectorAll("[data-map-id]")];
    let hoveredIndex = null;
    let selectedIndex = null;
    const occurrences = {preview: null, shown: null, drawn: null, cache: {}};
    const recordPopup = new maplibregl.Popup({closeButton: false, maxWidth: "340px", offset: 8, className: "imerss-project-popup"});

    /**
     * Fetch the records at a URL, once.
     * @param {String} url - The URL of a GeoJSON FeatureCollection of records.
     * @return {Promise<Object>} A promise for the FeatureCollection.
     */
    const fetchOccurrences = function (url) {
        occurrences.cache[url] = occurrences.cache[url] || fetch(url).then(response => {
            if (!response.ok) {
                throw new Error("HTTP " + response.status + " fetching " + url);
            }
            return response.json();
        });
        return occurrences.cache[url];
    };

    /**
     * Draw the records previewed, or failing that those shown, or none.
     */
    const drawOccurrences = async function () {
        const url = occurrences.preview || occurrences.shown;
        if (!loaded || url === occurrences.drawn) {
            return;
        }
        occurrences.drawn = url;
        recordPopup.remove();
        const data = url ? await fetchOccurrences(url) : {type: "FeatureCollection", features: []};
        if (occurrences.drawn === url && map.getSource("occurrences")) {
            map.getSource("occurrences").setData(data);
        }
    };

    /**
     * Mark a place as opened in the list, bringing it into view, or clear the mark and return to the overview.
     * @param {Number|null} index - The index of the opened place, or null if none is open.
     */
    const setSelected = function (index) {
        if (!loaded) {
            selectedIndex = index;
            return;
        }
        if (selectedIndex !== null) {
            map.setFeatureState({source: "places", id: selectedIndex}, {selected: false});
        }
        selectedIndex = index;
        if (index !== null) {
            map.setFeatureState({source: "places", id: index}, {selected: true});
            map.fitBounds(imerssBounds(places[index].boundary), {padding: 60, maxZoom: 12});
        } else {
            map.fitBounds(opts.bounds, {padding: 0});
        }
    };

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

    let loaded = false;
    document.addEventListener("imerss-preview-occurrences", e => {
        occurrences.preview = e.detail.url;
        drawOccurrences();
    });
    document.addEventListener("imerss-show-occurrences", e => {
        occurrences.shown = e.detail.url;
        drawOccurrences();
    });
    document.addEventListener("imerss-place-opened", e => {
        const index = places.findIndex(place => place.id === e.detail.id);
        setSelected(index === -1 ? null : index);
    });

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

        map.addSource("occurrences", {type: "geojson", data: {type: "FeatureCollection", features: []}});
        map.addLayer({
            id: "occurrence-points",
            type: "circle",
            source: "occurrences",
            paint: {
                "circle-color": imerssOccurrencePaint.colour,
                "circle-radius": ["interpolate", ["linear"], ["zoom"],
                    8, ["case", ["has", "records"], ["interpolate", ["linear"], ["sqrt", ["get", "records"]], 1, 3, 10, 6, 40, 12], 3],
                    13, ["case", ["has", "records"], ["interpolate", ["linear"], ["sqrt", ["get", "records"]], 1, 5, 10, 10, 40, 18], 6]],
                "circle-stroke-color": imerssOccurrencePaint.stroke,
                "circle-stroke-width": 1,
                "circle-opacity": 0.9
            }
        });
        map.on("mouseenter", "occurrence-points", () => {
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "occurrence-points", () => {
            map.getCanvas().style.cursor = "";
        });

        loaded = true;
        if (selectedIndex !== null) {
            setSelected(selectedIndex);
        }
        drawOccurrences();

        map.on("mousemove", "place-fill", e => {
            const overRecord = map.queryRenderedFeatures(e.point, {layers: ["occurrence-points"]}).length > 0;
            if (overRecord || selectedIndex !== null) {
                hoverPopup.remove();
            } else if (canHover) {
                const index = imerssPlaceAt(map, e.point);
                map.getCanvas().style.cursor = "pointer";
                if (index !== hoveredIndex) {
                    setHovered(index);
                    hoverPopup.setHTML(imerssPlacePopupHtml(places[index]));
                }
                hoverPopup.setLngLat(e.lngLat).addTo(map);
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
            const record = map.queryRenderedFeatures(e.point, {layers: ["occurrence-points"]})[0];
            if (record) {
                recordPopup.setLngLat(record.geometry.coordinates).setHTML(imerssOccurrencePopupHtml(record.properties)).addTo(map);
                return;
            }
            const index = imerssPlaceAt(map, e.point);
            if (index !== null) {
                imerssOpenPlaceInList(places[index].id, opts.listUrl);
            }
        });

        // Highlight a place while the pointer is over its section in a list on the page
        listSections.forEach(section => {
            const index = places.findIndex(place => place.id === section.dataset.mapId);
            if (index !== -1) {
                section.addEventListener("mouseenter", () => setHovered(index));
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
        const map = imerssProjectMap(container, places, {...(bounds && {bounds}), listUrl: container.dataset.listUrl});
        const showcaseElement = container.parentElement.querySelector(".imerss-showcase-data");
        if (showcaseElement && window.imerssShowcase) {
            window.imerssShowcase(map, container, JSON.parse(showcaseElement.textContent),
                bounds || imerssProjectMapDefaults.bounds);
        }
    });
});
