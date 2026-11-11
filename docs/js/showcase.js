/* global maplibregl */

"use strict";

/*
 * Features each project and dataset in turn on the landing page's map, in a random order: the places it covers are
 * outlined and a caption links to its entry on this site. Between items the map returns to the whole Salish Sea.
 */

// Milliseconds each item is shown, and the overview between items
const imerssShowcaseInterval = 8000;
const imerssShowcaseOverview = 3500;

const imerssShowcasePaint = {
    outline: "#FDF2CE"
};

/**
 * Shuffle an array in place, by the Fisher-Yates algorithm.
 * @param {Array} array - The array to shuffle.
 * @return {Array} The array, shuffled.
 */
const imerssShuffle = function (array) {
    for (let i = array.length - 1; i > 0; --i) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

/**
 * Compute the bounds of a set of GeoJSON features.
 * @param {Object[]} features - GeoJSON features.
 * @return {Number[][]|null} Their bounds as [[west, south], [east, north]], or null if they hold no coordinates.
 */
const imerssFeatureBounds = function (features) {
    const bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
    const visit = coords => {
        if (typeof coords[0] === "number") {
            bounds[0] = [Math.min(bounds[0][0], coords[0]), Math.min(bounds[0][1], coords[1])];
            bounds[1] = [Math.max(bounds[1][0], coords[0]), Math.max(bounds[1][1], coords[1])];
        } else {
            coords.forEach(visit);
        }
    };
    features.forEach(feature => visit(feature.geometry.coordinates));
    return isFinite(bounds[0][0]) ? bounds : null;
};

/**
 * Describe the places an item covers, naming up to three of them.
 * @param {String[]} places - The names of the places.
 * @return {String} A short description of the places.
 */
const imerssShowcasePlaces = function (places) {
    const names = places.filter(Boolean);
    return names.length > 3 ? names.length + " places" : names.join(", ");
};

/**
 * Feature each project and dataset in turn on a map.
 * @param {maplibregl.Map} map - The map, as created by `imerssProjectMap`.
 * @param {HTMLElement} container - The map's container, within which the caption is placed.
 * @param {Object[]} items - The projects and datasets to feature.
 * @param {Number[][]} overviewBounds - The bounds of the whole Salish Sea, as [[west, south], [east, north]], to which the
 * map returns between items.
 */
window.imerssShowcase = function (map, container, items, overviewBounds) {
    if (items.length === 0) {
        return;
    }
    const order = imerssShuffle(items.map((item, index) => index));
    let position = -1, timer = null, playing = true;

    const caption = document.createElement("div");
    caption.className = "imerss-showcase";
    caption.innerHTML = "<p class=\"imerss-showcase-kind\"></p>" +
        "<a class=\"imerss-showcase-title\"></a>" +
        "<div class=\"imerss-showcase-controls\">" +
        "<button type=\"button\" class=\"imerss-showcase-play\" aria-label=\"Pause\"></button>" +
        "<button type=\"button\" class=\"imerss-showcase-next\" aria-label=\"Show the next project or dataset\">" +
        "<svg viewBox=\"0 0 20 20\" width=\"16\" height=\"16\" aria-hidden=\"true\"><path d=\"M7 4l6 6-6 6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" +
        "</button><span class=\"imerss-showcase-count\"></span></div>";
    container.appendChild(caption);
    const playButton = caption.querySelector(".imerss-showcase-play");

    const showPlaying = function () {
        playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
        playButton.innerHTML = playing ?
            "<svg viewBox=\"0 0 20 20\" width=\"16\" height=\"16\" aria-hidden=\"true\"><path d=\"M7 4v12M13 4v12\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\"/></svg>" :
            "<svg viewBox=\"0 0 20 20\" width=\"16\" height=\"16\" aria-hidden=\"true\"><path d=\"M6 4l10 6-10 6z\" fill=\"currentColor\"/></svg>";
    };

    const schedule = function () {
        clearTimeout(timer);
        if (playing) {
            timer = setTimeout(overview, imerssShowcaseInterval);
        }
    };

    const overview = function () {
        map.getSource("showcase-area").setData({type: "FeatureCollection", features: []});
        map.fitBounds(overviewBounds, {padding: 0, duration: 2500});
        caption.classList.add("imerss-showcase-hidden");
        clearTimeout(timer);
        timer = setTimeout(() => show(position + 1), imerssShowcaseOverview);
    };

    const show = function (next) {
        position = (next + order.length) % order.length;
        const item = items[order[position]];
        caption.querySelector(".imerss-showcase-kind").textContent = item.kind + (item.places.length ? " · " + imerssShowcasePlaces(item.places) : "");
        const title = caption.querySelector(".imerss-showcase-title");
        title.textContent = item.title;
        title.href = item.url;
        caption.querySelector(".imerss-showcase-count").textContent = (position + 1) + " / " + order.length;
        caption.classList.remove("imerss-showcase-hidden");
        schedule();

        map.getSource("showcase-area").setData({type: "FeatureCollection", features: item.area});
        const bounds = imerssFeatureBounds(item.area);
        if (bounds) {
            map.fitBounds(bounds, {padding: {top: 60, bottom: 160, left: 60, right: 60}, maxZoom: 11.5, duration: 2500});
        }
    };

    playButton.addEventListener("click", () => {
        playing = !playing;
        showPlaying();
        schedule();
    });
    caption.querySelector(".imerss-showcase-next").addEventListener("click", () => show(position + 1));

    const pause = () => {
        if (playing) {
            playing = false;
            showPlaying();
            schedule();
        }
    };
    map.getCanvas().addEventListener("pointerdown", pause);
    map.getCanvas().addEventListener("wheel", pause, {passive: true});

    const start = function () {
        map.addSource("showcase-area", {type: "geojson", data: {type: "FeatureCollection", features: []}});
        map.addLayer({id: "showcase-fill", type: "fill", source: "showcase-area",
            paint: {"fill-color": imerssShowcasePaint.outline, "fill-opacity": 0.1}});
        map.addLayer({id: "showcase-outline", type: "line", source: "showcase-area",
            paint: {"line-color": imerssShowcasePaint.outline, "line-width": 2}});
        showPlaying();
        show(0);
    };
    if (map.loaded()) {
        start();
    } else {
        map.once("load", start);
    }
};
