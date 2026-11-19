/* global maplibregl */

"use strict";

/*
 * Features each project and dataset in turn on the landing page's map, in a random order: the places it covers are
 * outlined, brightening as the map flies in so that it reaches full strength as the map arrives, and a caption links to its
 * entry on this site. Between items the map draws back to the whole Salish Sea,
 * rests there for a moment, and flies on to the next.
 */

// Milliseconds each item is held once the map has arrived at it, the camera takes to fly in and draw back out, the
// map rests on the whole Salish Sea between items, and the outline and caption take to fade
const imerssShowcaseHold = 7000;
const imerssShowcaseFlight = 3200;
const imerssShowcaseRetreat = 2600;
const imerssShowcaseRest = 600;
const imerssShowcaseFade = 600;

// The share of the flight in, from its start, before the item's outline begins to brighten
const imerssShowcaseRevealStart = 0.35;

const imerssShowcaseEase = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

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
    caption.className = "imerss-showcase imerss-showcase-hidden";
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

    // Each step of the tour checks it is still current, so that skipping ahead or pausing abandons the rest of the step
    let step = 0;
    const wait = (ms, current) => new Promise(resolve => {
        clearTimeout(timer);
        timer = setTimeout(resolve, ms);
    }).then(() => current === step);
    const arrive = current => new Promise(resolve => map.isMoving() ? map.once("moveend", resolve) : resolve())
        .then(() => current === step);

    /**
     * Set the outline's opacity, fading to it, or setting it at once when tracking the camera frame by frame.
     * @param {Number} opacity - The opacity, from 0 to 1.
     * @param {Boolean} [immediate] - Whether to set it at once rather than fade to it.
     */
    const setOutline = function (opacity, immediate) {
        const transition = {duration: immediate ? 0 : imerssShowcaseFade, delay: 0};
        map.setPaintProperty("showcase-outline", "line-opacity-transition", transition);
        map.setPaintProperty("showcase-fill", "fill-opacity-transition", transition);
        map.setPaintProperty("showcase-outline", "line-opacity", opacity);
        map.setPaintProperty("showcase-fill", "fill-opacity", opacity * 0.1);
    };

    /**
     * Brighten the outline in step with the flight in, from nothing until partway through to full strength on arrival.
     * @param {Number} current - The step of the tour this flight belongs to.
     * @param {Number} duration - The flight's duration in milliseconds.
     */
    const reveal = function (current, duration) {
        const begun = performance.now();
        const frame = now => {
            if (current !== step) {
                return;
            }
            const t = Math.min(1, (now - begun) / duration);
            const ramp = Math.max(0, (t - imerssShowcaseRevealStart) / (1 - imerssShowcaseRevealStart));
            // Ease in, so that most of the brightening comes in the last moments of the approach
            setOutline(ramp * ramp * (3 - 2 * ramp), true);
            if (t < 1 && map.isMoving()) {
                requestAnimationFrame(frame);
            }
        };
        requestAnimationFrame(frame);
    };

    // Leave room beneath the item for the caption, which takes up more of a small map
    const padding = function () {
        const rect = container.getBoundingClientRect(), margin = Math.min(60, rect.width * 0.1);
        const bottom = Math.min(caption.offsetHeight + 36 + margin / 2, rect.height * 0.5);
        return {top: margin, bottom, left: margin, right: margin};
    };

    // Hold the current item, then draw back to the whole Salish Sea, rest for a moment and fly on to the next
    const hold = async function (current) {
        if (!playing || !await wait(imerssShowcaseHold, current)) {
            return;
        }
        setOutline(0);
        caption.classList.add("imerss-showcase-hidden");
        if (!await wait(imerssShowcaseFade, current)) {
            return;
        }
        map.fitBounds(overviewBounds, {padding: 0, duration: imerssShowcaseRetreat, easing: imerssShowcaseEase});
        if (await arrive(current) && await wait(imerssShowcaseRest, current)) {
            show(position + 1);
        }
    };

    const show = async function (next) {
        const current = ++step;
        position = (next + order.length) % order.length;
        const item = items[order[position]];
        caption.querySelector(".imerss-showcase-kind").textContent = item.kind + (item.places.length ? " · " + imerssShowcasePlaces(item.places) : "");
        const title = caption.querySelector(".imerss-showcase-title");
        title.textContent = item.title;
        title.href = item.url;
        caption.querySelector(".imerss-showcase-count").textContent = (position + 1) + " / " + order.length;
        caption.classList.remove("imerss-showcase-hidden");

        setOutline(0, true);
        map.getSource("showcase-area").setData({type: "FeatureCollection", features: item.area});
        const bounds = imerssFeatureBounds(item.area);
        const camera = bounds && map.cameraForBounds(bounds, {padding: padding(), maxZoom: 11.5});
        if (camera) {
            map.flyTo({...camera, duration: imerssShowcaseFlight, curve: 1.2, easing: imerssShowcaseEase});
            reveal(current, imerssShowcaseFlight);
        }
        if (await arrive(current)) {
            setOutline(1, true);
            hold(current);
        }
    };

    playButton.addEventListener("click", () => {
        playing = !playing;
        showPlaying();
        if (playing) {
            show(position + 1);
        } else {
            ++step;
            clearTimeout(timer);
        }
    });
    caption.querySelector(".imerss-showcase-next").addEventListener("click", () => show(position + 1));

    // Pause when someone moves the map themselves - not when they merely tap it, or touch it to scroll the page
    const pause = e => {
        if (playing && e.originalEvent) {
            playing = false;
            ++step;
            clearTimeout(timer);
            setOutline(1);
            caption.classList.remove("imerss-showcase-hidden");
            showPlaying();
        }
    };
    ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach(type => map.on(type, pause));

    const start = function () {
        map.addSource("showcase-area", {type: "geojson", data: {type: "FeatureCollection", features: []}});
        map.addLayer({id: "showcase-fill", type: "fill", source: "showcase-area",
            paint: {"fill-color": imerssShowcasePaint.outline, "fill-opacity": 0,
                "fill-opacity-transition": {duration: imerssShowcaseFade}}});
        map.addLayer({id: "showcase-outline", type: "line", source: "showcase-area",
            paint: {"line-color": imerssShowcasePaint.outline, "line-width": 2, "line-opacity": 0,
                "line-opacity-transition": {duration: imerssShowcaseFade}}});
        showPlaying();
        show(0);
    };
    // Start as soon as the style is ready, without waiting for every tile to arrive, which can take a while on a slow
    // connection. The map's style is given inline, so is usually ready at once, though the map does not report itself
    // loaded until its tiles have arrived
    const tryStart = function () {
        if (!map.getSource("showcase-area") && map.style?._loaded) {
            map.off("styledata", tryStart);
            start();
        }
    };
    map.on("styledata", tryStart);
    tryStart();
};
