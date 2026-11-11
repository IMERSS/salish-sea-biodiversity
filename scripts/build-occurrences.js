/* eslint-env node */

"use strict";

/*
 * Builds, from the datasets and islands listed in projects.json: island outlines (data/islands.json), each dataset's
 * records by place (static/data/occurrences/), downloads of its source files whole and by place (static/data/downloads/),
 * and sampling sites summarising GBIF archives (static/data/sites/). Records whose coordinates disagree with their island
 * are listed in the dataset folder's island-check.csv. See README.md.
 *
 * Usage:
 *   node scripts/build-occurrences.js
 */

const fs = require("fs/promises");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "projects.json");
const islandsOutputPath = path.join(rootDir, "data", "islands.json");
const indexOutputPath = path.join(rootDir, "data", "occurrences.json");
const downloadsOutputPath = path.join(rootDir, "data", "downloads.json");
const downloadsDir = path.join(rootDir, "static", "data", "downloads");
const occurrencesDir = path.join(rootDir, "static", "data", "occurrences");
const sitesDir = path.join(rootDir, "static", "data", "sites");
const sitesIndexPath = path.join(rootDir, "data", "sites.json");

// About 100 metres
const siteDecimals = 3;

// About 3 metres; records are assigned to islands using the full outlines
const simplifyTolerance = 0.00003;

// Columns carried into each point, for its popup on the map
const pointFields = ["occurrenceID", "scientificName", "verbatimIdentification", "eventDate", "locality", "habitat",
    "organismQuantity", "organismQuantityType", "occurrenceRemarks", "recordedBy", "fieldNotes", "island"];

/**
 * Parse CSV text, honouring quoted fields which may hold commas, doubled quotes and line breaks.
 * @param {String} text - The CSV text, whose first row names the columns.
 * @return {Object[]} One object per row, keyed by column name.
 */
const parseCsv = function (text) {
    const rows = [];
    let row = [], field = "", quoted = false, start = 0;
    for (let i = 0; i < text.length; ++i) {
        const c = text[i];
        if (quoted) {
            if (c === "\"" && text[i + 1] === "\"") {
                field += "\"";
                ++i;
            } else if (c === "\"") {
                quoted = false;
            } else {
                field += c;
            }
        } else if (c === "\"") {
            quoted = true;
        } else if (c === ",") {
            row.push(field);
            field = "";
        } else if (c === "\n" || c === "\r") {
            row.push(field);
            row.raw = text.slice(start, i);
            rows.push(row);
            if (c === "\r" && text[i + 1] === "\n") {
                ++i;
            }
            start = i + 1;
            row = [];
            field = "";
        } else {
            field += c;
        }
    }
    if (field || row.length) {
        row.push(field);
        row.raw = text.slice(start);
        rows.push(row);
    }
    const [header, ...body] = rows.filter(r => r.some(value => value !== ""));
    const columns = header.map(name => name.replace(/^\uFEFF/, "").trim());
    const records = body.map(r => {
        const record = Object.fromEntries(columns.map((name, i) => [name, r[i] ?? ""]));
        Object.defineProperty(record, "raw", {value: r.raw});
        return record;
    });
    records.header = header.raw;
    return records;
};

/**
 * Read the named polygons from a KML file.
 * @param {String} text - The KML text.
 * @return {Object[]} One entry per named placemark, with `name` and `polygons` - an array of polygons, each an array
 * of rings (outer ring first) of [longitude, latitude] pairs - and `bbox` as [west, south, east, north].
 */
const parseKmlPolygons = function (text) {
    const islands = [];
    for (const [, placemark] of text.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
        const name = /<name>([\s\S]*?)<\/name>/.exec(placemark);
        if (name) {
            const polygons = [...placemark.matchAll(/<Polygon>([\s\S]*?)<\/Polygon>/g)].map(([, polygon]) =>
                [...polygon.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)].map(([, coords]) =>
                    coords.trim().split(/\s+/).map(pair => pair.split(",").slice(0, 2).map(Number))));
            const bbox = [Infinity, Infinity, -Infinity, -Infinity];
            polygons.forEach(polygon => polygon.forEach(ring => ring.forEach(([x, y]) => {
                bbox[0] = Math.min(bbox[0], x);
                bbox[1] = Math.min(bbox[1], y);
                bbox[2] = Math.max(bbox[2], x);
                bbox[3] = Math.max(bbox[3], y);
            })));
            islands.push({name: name[1].trim(), polygons, bbox});
        }
    }
    return islands;
};

/**
 * Simplify a line by the Douglas-Peucker algorithm.
 * @param {Number[][]} points - The line's [longitude, latitude] pairs.
 * @param {Number} tolerance - The greatest distance, in degrees, by which the simplified line may depart from the line.
 * @return {Number[][]} The simplified line, keeping the first and last points.
 */
const simplifyLine = function (points, tolerance) {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop();
        const [ax, ay] = points[first], [bx, by] = points[last];
        const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
        let furthest = -1, greatest = tolerance;
        for (let i = first + 1; i < last; ++i) {
            const [px, py] = points[i];
            const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
            if (distance > greatest) {
                furthest = i;
                greatest = distance;
            }
        }
        if (furthest !== -1) {
            keep[furthest] = 1;
            stack.push([first, furthest], [furthest, last]);
        }
    }
    return points.filter((point, i) => keep[i]).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
};

/**
 * Simplify an island's polygons into a GeoJSON MultiPolygon, dropping rings too small to survive simplification.
 * @param {Object} island - An island as returned from `parseKmlPolygons`.
 * @return {Object} A GeoJSON MultiPolygon geometry.
 */
const simplifyIsland = function (island) {
    const coordinates = island.polygons.map(polygon =>
        polygon.map(ring => simplifyLine(ring, simplifyTolerance)).filter(ring => ring.length >= 4))
        .filter(polygon => polygon.length > 0);
    return {type: "MultiPolygon", coordinates};
};

/**
 * Determine whether a point lies within a ring, by ray casting.
 * @param {Number} x - The point's longitude.
 * @param {Number} y - The point's latitude.
 * @param {Number[][]} ring - The ring's [longitude, latitude] pairs.
 * @return {Boolean} Whether the point lies within the ring.
 */
const inRing = function (x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
};

/**
 * Determine whether a point lies on an island - within the outer ring of one of its polygons. Holes, such as lakes and
 * quarries, are counted as part of the island.
 * @param {Number} x - The point's longitude.
 * @param {Number} y - The point's latitude.
 * @param {Object} island - An island as returned from `parseKmlPolygons`.
 * @return {Boolean} Whether the point lies on the island.
 */
const onIsland = function (x, y, island) {
    const [west, south, east, north] = island.bbox;
    return x >= west && x <= east && y >= south && y <= north && island.polygons.some(polygon => inRing(x, y, polygon[0]));
};

/**
 * Find the distance from a point to the nearest vertex of an island's outline, roughly in metres.
 * @param {Number} x - The point's longitude.
 * @param {Number} y - The point's latitude.
 * @param {Object} island - An island as returned from `parseKmlPolygons`.
 * @return {Number} The distance in metres.
 */
const distanceToIsland = function (x, y, island) {
    const scale = Math.cos(y * Math.PI / 180);
    let nearest = Infinity;
    island.polygons.forEach(polygon => polygon.forEach(ring => ring.forEach(([px, py]) => {
        nearest = Math.min(nearest, Math.hypot((px - x) * scale, py - y));
    })));
    return nearest * 111320;
};

/**
 * Find the smallest island holding a point, ignoring the mainland and Vancouver Island, which in the islands file
 * enclose many smaller islands.
 * @param {Number} x - The point's longitude.
 * @param {Number} y - The point's latitude.
 * @param {Object[]} islands - Islands as returned from `parseKmlPolygons`.
 * @return {Object|null} The island holding the point, or null if none does.
 */
const islandAt = function (x, y, islands) {
    const area = island => (island.bbox[2] - island.bbox[0]) * (island.bbox[3] - island.bbox[1]);
    const holding = islands.filter(island => !/^(North America|Vancouver Island)$/.test(island.name) && onIsland(x, y, island));
    return holding.sort((a, b) => area(a) - area(b))[0] || null;
};

/**
 * Summarise the records of a Darwin Core Archive's tab-separated occurrence file into one point per site.
 * @param {String} text - The occurrence file's text, whose first line names its columns.
 * @return {Object} An object with `sites`, a GeoJSON FeatureCollection of points whose properties hold `records`,
 * `taxa` and `firstYear` and `lastYear`, and `records` and `located`, the numbers of records and of those with
 * coordinates.
 */
const summariseSites = function (text) {
    const [header, ...lines] = text.split(/\r?\n/).filter(line => line !== "");
    const columns = header.split("\t");
    const column = name => columns.indexOf(name);
    const [lat, lon, year, name] = ["decimalLatitude", "decimalLongitude", "year", "scientificName"].map(column);
    const sites = new Map();
    let located = 0;
    lines.forEach(line => {
        const values = line.split("\t");
        const y = Number(values[lat]), x = Number(values[lon]);
        if (values[lat] && values[lon] && isFinite(x) && isFinite(y)) {
            ++located;
            const key = x.toFixed(siteDecimals) + "," + y.toFixed(siteDecimals);
            const site = sites.get(key) || {records: 0, taxa: new Set(), years: []};
            site.records++;
            if (values[name]) {
                site.taxa.add(values[name]);
            }
            if (Number(values[year])) {
                site.years.push(Number(values[year]));
            }
            sites.set(key, site);
        }
    });
    const features = [...sites.entries()].map(([key, site]) => ({
        type: "Feature",
        properties: {
            records: site.records,
            taxa: site.taxa.size,
            ...(site.years.length && {firstYear: Math.min(...site.years), lastYear: Math.max(...site.years)})
        },
        geometry: {type: "Point", coordinates: key.split(",").map(Number)}
    })).sort((a, b) => b.properties.records - a.properties.records);
    return {sites: {type: "FeatureCollection", features}, records: lines.length, located};
};

/**
 * Quote a value for a CSV file.
 * @param {String|Number} value - The value.
 * @return {String} The quoted value.
 */
const csvValue = value => "\"" + String(value ?? "").replace(/"/g, "\"\"") + "\"";

/**
 * Build the island outlines and occurrence points for all places and datasets listed in projects.json.
 * @return {Promise} A promise which resolves when all files have been written.
 */
const main = async function () {
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    const islands = parseKmlPolygons(await fs.readFile(path.join(rootDir, config.islandsFile), "utf8"));
    const islandPlaces = config.places.filter(place => place.island);

    const islandFor = {};
    islandPlaces.forEach(place => {
        const named = islands.filter(island => island.name === place.island);
        if (named.length === 0) {
            throw new Error("Place " + place.id + " names island " + JSON.stringify(place.island) + ", which is not in " + config.islandsFile);
        }
        const size = island => (island.bbox[2] - island.bbox[0]) * (island.bbox[3] - island.bbox[1]);
        islandFor[place.id] = named.sort((a, b) => size(b) - size(a))[0];
    });

    const outlines = Object.fromEntries(islandPlaces.map(place => [place.id, {
        type: "FeatureCollection",
        features: [{type: "Feature", properties: {name: place.island}, geometry: simplifyIsland(islandFor[place.id])}]
    }]));
    await fs.writeFile(islandsOutputPath, JSON.stringify(outlines) + "\n");
    console.log("Wrote outlines of " + islandPlaces.length + " island(s) to " + path.relative(rootDir, islandsOutputPath));

    const placeByIsland = Object.fromEntries(islandPlaces.map(place => [place.island, place]));
    const index = {};
    const downloads = {};
    await fs.rm(occurrencesDir, {recursive: true, force: true});
    await fs.rm(downloadsDir, {recursive: true, force: true});

    for (const entry of (config.datasets || []).filter(dataset => dataset.occurrences)) {
        const id = path.basename(entry.dir);
        const {files, placeField = "island", locateBy = {}} = entry.occurrences;
        const byPlace = {};
        const flagged = [];
        const subsets = [];
        for (const file of files) {
            const text = await fs.readFile(path.join(rootDir, file), "utf8");
            const rows = parseCsv(text);
            const subset = {file, header: rows.header, newline: text.includes("\r\n") ? "\r\n" : "\n", byPlace: {}};
            subsets.push(subset);
            rows.forEach(row => {
                const x = Number(row.decimalLongitude), y = Number(row.decimalLatitude);
                const hasPoint = row.decimalLongitude !== "" && row.decimalLatitude !== "" && isFinite(x) && isFinite(y);
                const value = row[placeField];
                let place = placeByIsland[value];
                const found = hasPoint ? islandAt(x, y, islands) : null;
                if (locateBy[value]) {
                    const candidates = locateBy[value].map(name => placeByIsland[name]);
                    place = hasPoint ? candidates.find(candidate => found === islandFor[candidate.id]) ||
                        candidates.sort((a, b) => distanceToIsland(x, y, islandFor[a.id]) - distanceToIsland(x, y, islandFor[b.id]))[0] : null;
                }
                if (!place || !hasPoint) {
                    flagged.push({row, file, problem: !hasPoint ? "no coordinates" : "no place for " + placeField + " " + JSON.stringify(value),
                        found, distance: ""});
                    return;
                }
                if (found !== islandFor[place.id]) {
                    flagged.push({row, file, problem: "assigned to " + place.island + " but lies " +
                        (found ? "on " + found.name : "off any island"), found,
                    distance: Math.round(distanceToIsland(x, y, islandFor[place.id]))});
                }
                (subset.byPlace[place.id] = subset.byPlace[place.id] || []).push(row.raw);
                const properties = Object.fromEntries(pointFields.filter(field => row[field]).map(field => [field, row[field]]));
                (byPlace[place.id] = byPlace[place.id] || []).push({
                    type: "Feature",
                    properties: {...properties, source: path.basename(file)},
                    geometry: {type: "Point", coordinates: [+x.toFixed(6), +y.toFixed(6)]}
                });
            });
        }

        await fs.mkdir(path.join(downloadsDir, id), {recursive: true});
        downloads[id] = {files: [], places: {}};
        for (const {file, header, newline, byPlace: rowsByPlace} of subsets) {
            const base = path.basename(file, path.extname(file));
            await fs.copyFile(path.join(rootDir, file), path.join(downloadsDir, id, base + ".csv"));
            downloads[id].files.push({url: "data/downloads/" + id + "/" + base + ".csv", name: base + ".csv"});
            for (const [placeId, lines] of Object.entries(rowsByPlace)) {
                const name = base + "-" + placeId + ".csv";
                await fs.writeFile(path.join(downloadsDir, id, name), [header, ...lines].join(newline) + newline);
                (downloads[id].places[placeId] = downloads[id].places[placeId] || [])
                    .push({url: "data/downloads/" + id + "/" + name, name, count: lines.length});
            }
        }

        const datasetDir = path.join(occurrencesDir, id);
        await fs.mkdir(datasetDir, {recursive: true});
        index[id] = {};
        for (const [placeId, features] of Object.entries(byPlace)) {
            await fs.writeFile(path.join(datasetDir, placeId + ".geojson"), JSON.stringify({type: "FeatureCollection", features}));
            index[id][placeId] = {url: "data/occurrences/" + id + "/" + placeId + ".geojson", count: features.length};
        }
        const total = Object.values(byPlace).reduce((sum, features) => sum + features.length, 0);
        console.log("Wrote " + total + " occurrence(s) of " + id + " across " + Object.keys(byPlace).length + " place(s)");

        const columns = ["source", "occurrenceID", "problem", "island", "locality", "decimalLatitude", "decimalLongitude",
            "metresFromAssignedIsland"];
        const checkPath = path.join(rootDir, entry.dir, "island-check.csv");
        await fs.writeFile(checkPath, [columns.map(csvValue).join(","), ...flagged.map(({row, file, problem, distance}) =>
            [path.basename(file), row.occurrenceID, problem, row.island, row.locality, row.decimalLatitude,
                row.decimalLongitude, distance].map(csvValue).join(","))].join("\n") + "\n");
        console.log("Listed " + flagged.length + " record(s) for review in " + path.relative(rootDir, checkPath));
    }
    await fs.writeFile(indexOutputPath, JSON.stringify(index, null, 2) + "\n");
    await fs.writeFile(downloadsOutputPath, JSON.stringify(downloads, null, 2) + "\n");

    let sitesIndex = {};
    try {
        sitesIndex = JSON.parse(await fs.readFile(sitesIndexPath, "utf8"));
    } catch (e) {
        if (e.code !== "ENOENT") {
            throw e;
        }
    }
    const siteDatasets = (config.datasets || []).filter(dataset => dataset.sites);
    await fs.mkdir(sitesDir, {recursive: true});
    for (const entry of siteDatasets) {
        const id = path.basename(entry.dir);
        let text;
        try {
            text = await fs.readFile(path.join(rootDir, entry.sites.archive), "utf8");
        } catch (e) {
            if (e.code === "ENOENT" && sitesIndex[id]) {
                console.warn("No archive at " + entry.sites.archive + " - keeping the sites of " + id + " built previously");
                continue;
            }
            throw e;
        }
        const {sites, records, located} = summariseSites(text);
        await fs.writeFile(path.join(sitesDir, id + ".geojson"), JSON.stringify(sites));
        sitesIndex[id] = {url: "data/sites/" + id + ".geojson", count: records, located, sites: sites.features.length};
        console.log("Summarised " + records + " record(s) of " + id + " (" + located + " with coordinates) into " +
            sites.features.length + " site(s)");
    }
    const siteIds = new Set(siteDatasets.map(entry => path.basename(entry.dir)));
    sitesIndex = Object.fromEntries(Object.entries(sitesIndex).filter(([id]) => siteIds.has(id)));
    await fs.writeFile(sitesIndexPath, JSON.stringify(sitesIndex, null, 2) + "\n");
};

main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
