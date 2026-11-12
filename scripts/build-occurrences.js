/* eslint-env node */

"use strict";

/*
 * Builds, from the places and datasets listed in projects.json: the outlines of places made of islands
 * (data/islands.json), each dataset's records (static/data/occurrences/), downloads of its source files
 * (static/data/downloads/), and sampling sites summarising larger datasets (static/data/sites/). Records whose coordinates
 * disagree with their island are listed in the dataset folder's island-check.csv. See README.md.
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
    let row = [], field = "", quoted = false;
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
            rows.push(row);
            if (c === "\r" && text[i + 1] === "\n") {
                ++i;
            }
            row = [];
            field = "";
        } else {
            field += c;
        }
    }
    if (field || row.length) {
        row.push(field);
        rows.push(row);
    }
    const [header, ...body] = rows.filter(r => r.some(value => value !== ""));
    const columns = header.map(name => name.replace(/^\uFEFF/, "").trim());
    return body.map(r => Object.fromEntries(columns.map((name, i) => [name, r[i] ?? ""])));
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
 * Read a table of Darwin Core records: comma-separated if its name ends in .csv, else tab-separated as in a Darwin Core
 * Archive.
 * @param {String} file - The table's path.
 * @param {String} text - The table's text, whose first line names its columns.
 * @return {Object[]} One object per record, keyed by column name.
 */
const parseRecords = function (file, text) {
    if (file.endsWith(".csv")) {
        return parseCsv(text);
    }
    const [header, ...lines] = text.split(/\r?\n/).filter(line => line !== "");
    const columns = header.split("\t");
    return lines.map(line => {
        const values = line.split("\t");
        return Object.fromEntries(columns.map((name, i) => [name, values[i] ?? ""]));
    });
};

/**
 * Summarise records into one point per site, giving the number of records there.
 * @param {Object[]} records - Darwin Core records.
 * @return {Object} A GeoJSON FeatureCollection of the sites, largest first.
 */
const summariseSites = function (records) {
    const sites = new Map();
    records.forEach(record => {
        const x = Number(record.decimalLongitude), y = Number(record.decimalLatitude);
        if (record.decimalLatitude && record.decimalLongitude && isFinite(x) && isFinite(y)) {
            const key = x.toFixed(siteDecimals) + "," + y.toFixed(siteDecimals);
            sites.set(key, (sites.get(key) || 0) + 1);
        }
    });
    const features = [...sites.entries()].map(([key, records]) => ({
        type: "Feature",
        properties: {records},
        geometry: {type: "Point", coordinates: key.split(",").map(Number)}
    })).sort((a, b) => b.properties.records - a.properties.records);
    return {type: "FeatureCollection", features};
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
    const islandPlaces = config.places.filter(place => place.islands);

    // Names repeat across the Salish Sea, so each name is taken as the largest island bearing it
    const size = island => (island.bbox[2] - island.bbox[0]) * (island.bbox[3] - island.bbox[1]);
    const islandNamed = name => {
        const named = islands.filter(island => island.name === name).sort((a, b) => size(b) - size(a));
        if (named.length === 0) {
            throw new Error("Island " + JSON.stringify(name) + " is not in " + config.islandsFile);
        }
        return named[0];
    };
    const outlines = Object.fromEntries(islandPlaces.map(place => [place.id, {
        type: "FeatureCollection",
        features: place.islands.map(name => ({type: "Feature", properties: {name}, geometry: simplifyIsland(islandNamed(name))}))
    }]));
    await fs.writeFile(islandsOutputPath, JSON.stringify(outlines) + "\n");
    console.log("Wrote outlines of " + islandPlaces.length + " place(s) to " + path.relative(rootDir, islandsOutputPath));

    const index = {};
    const downloads = {};
    await fs.rm(occurrencesDir, {recursive: true, force: true});
    await fs.rm(downloadsDir, {recursive: true, force: true});
    await fs.mkdir(occurrencesDir, {recursive: true});

    for (const entry of (config.datasets || []).filter(dataset => dataset.occurrences)) {
        const id = path.basename(entry.dir);
        const features = [];
        const flagged = [];
        await fs.mkdir(path.join(downloadsDir, id), {recursive: true});
        downloads[id] = [];
        for (const file of entry.occurrences.files) {
            const rows = parseCsv(await fs.readFile(path.join(rootDir, file), "utf8"));
            rows.forEach(row => {
                const x = Number(row.decimalLongitude), y = Number(row.decimalLatitude);
                if (row.decimalLongitude === "" || row.decimalLatitude === "" || !isFinite(x) || !isFinite(y)) {
                    flagged.push({row, file, problem: "no coordinates"});
                    return;
                }
                // "Pender Island" stands for North and South Pender alike
                const found = islandAt(x, y, islands);
                if (row.island && !(found && (found.name === row.island || found.name.endsWith(" " + row.island)))) {
                    flagged.push({row, file, problem: "lies " + (found ? "on " + found.name : "off any island")});
                }
                const properties = Object.fromEntries(pointFields.filter(field => row[field]).map(field => [field, row[field]]));
                features.push({
                    type: "Feature",
                    properties: {...properties, source: path.basename(file)},
                    geometry: {type: "Point", coordinates: [+x.toFixed(6), +y.toFixed(6)]}
                });
            });
            // Offered for download unchanged, named .csv so that it opens as a table
            const name = path.basename(file, path.extname(file)) + ".csv";
            await fs.copyFile(path.join(rootDir, file), path.join(downloadsDir, id, name));
            downloads[id].push({url: "data/downloads/" + id + "/" + name, name});
        }

        await fs.writeFile(path.join(occurrencesDir, id + ".geojson"), JSON.stringify({type: "FeatureCollection", features}));
        index[id] = {url: "data/occurrences/" + id + ".geojson", count: features.length};
        console.log("Wrote " + features.length + " occurrence(s) of " + id);

        const columns = ["source", "occurrenceID", "problem", "island", "locality", "decimalLatitude", "decimalLongitude"];
        const checkPath = path.join(rootDir, entry.dir, "island-check.csv");
        await fs.writeFile(checkPath, [columns.map(csvValue).join(","), ...flagged.map(({row, file, problem}) =>
            [path.basename(file), row.occurrenceID, problem, row.island, row.locality, row.decimalLatitude,
                row.decimalLongitude].map(csvValue).join(","))].join("\n") + "\n");
        console.log("Listed " + flagged.length + " record(s) for review in " + path.relative(rootDir, checkPath));
    }
    await fs.writeFile(indexOutputPath, JSON.stringify(index, null, 2) + "\n");

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
        const file = entry.sites.file;
        let text;
        try {
            text = await fs.readFile(path.join(rootDir, file), "utf8");
        } catch (e) {
            if (e.code === "ENOENT" && sitesIndex[id]) {
                console.warn("No file at " + file + " - keeping the sites of " + id + " built previously");
                continue;
            }
            throw e;
        }
        const records = parseRecords(file, text);
        const sites = summariseSites(records);
        await fs.writeFile(path.join(sitesDir, id + ".geojson"), JSON.stringify(sites));
        sitesIndex[id] = {url: "data/sites/" + id + ".geojson", count: records.length};
        console.log("Summarised " + records.length + " record(s) of " + id + " into " + sites.features.length + " site(s)");
        if (entry.sites.download) {
            await fs.mkdir(path.join(downloadsDir, id), {recursive: true});
            await fs.copyFile(path.join(rootDir, file), path.join(downloadsDir, id, id + ".csv"));
            downloads[id] = [{url: "data/downloads/" + id + "/" + id + ".csv", name: id + ".csv"}];
        }
    }
    const siteIds = new Set(siteDatasets.map(entry => path.basename(entry.dir)));
    sitesIndex = Object.fromEntries(Object.entries(sitesIndex).filter(([id]) => siteIds.has(id)));
    await fs.writeFile(sitesIndexPath, JSON.stringify(sitesIndex, null, 2) + "\n");
    await fs.writeFile(downloadsOutputPath, JSON.stringify(downloads, null, 2) + "\n");
};

main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
