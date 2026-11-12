/* eslint-env node */

"use strict";

/*
 * Collects the boundary GeoJSON and markdown description from the top level of each subsidiary project repository
 * listed in projects.json, and writes them to data/projects.json for the Hugo build to render onto the index map.
 * Datasets listed in projects.json are collected in the same way from their folders within this repository, and
 * written to data/datasets.json for the map shown in the Data section. A project may likewise be held in a folder within
 * this repository rather than in a repository of its own. Each project and dataset belongs to one of the places listed
 * in projects.json, which are written to data/places.json - the map outlines each place with the boundaries of the
 * projects or datasets within it, so a project held in this repository need not have a boundary of its own.
 *
 * Usage:
 *   node scripts/collect-projects.js                 - fetch from each repository's default branch on GitHub
 *   node scripts/collect-projects.js --local <dir>   - read from local checkouts held at <dir>/<repository name>
 *
 * If a project's files cannot be retrieved, any entry previously collected for it is retained so that a transient
 * failure does not remove the project from the map.
 */

const fs = require("fs/promises");
const fetch = require("node-fetch");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const configPath = path.join(rootDir, "projects.json");
const outputPath = path.join(rootDir, "data", "projects.json");
const datasetsOutputPath = path.join(rootDir, "data", "datasets.json");
const placesOutputPath = path.join(rootDir, "data", "places.json");

/**
 * Parse a GitHub repository URL into its owner and repository name.
 * @param {String} repoUrl - A repository URL such as `https://github.com/IMERSS/saanich-peninsula-flora`.
 * @return {Object} An object with members `owner` and `name` holding the repository's owner and name.
 */
const parseRepoUrl = function (repoUrl) {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
    if (match) {
        return {owner: match[1], name: match[2]};
    } else {
        throw new Error("Cannot parse GitHub repository URL " + repoUrl);
    }
};

/**
 * Compute the URL of the GitHub Pages site published from a repository's docs/ directory.
 * @param {Object} repo - A parsed repository as returned from `parseRepoUrl`.
 * @return {String} The base URL of the repository's published site, ending in a slash.
 */
const pagesUrl = function (repo) {
    const host = repo.owner.toLowerCase() + ".github.io";
    // A repository named after the Pages host is published at the root of that host
    return repo.name.toLowerCase() === host ? "https://" + host + "/" : "https://" + host + "/" + repo.name + "/story";
};

/**
 * Read a file from the top level of a project repository, either from GitHub or from a local checkout.
 * @param {Object} repo - A parsed repository as returned from `parseRepoUrl`.
 * @param {String} fileName - The name of the file at the top level of the repository.
 * @param {String|null} localDir - A directory holding local checkouts of the repositories, or null to fetch from GitHub.
 * @return {Promise<String>} A promise for the text content of the file.
 */
const readProjectFile = async function (repo, fileName, localDir) {
    if (localDir) {
        return fs.readFile(path.join(localDir, repo.name, fileName), "utf8");
    } else {
        const url = "https://raw.githubusercontent.com/" + repo.owner + "/" + repo.name + "/HEAD/" + fileName;
        const response = await fetch(url);
        if (response.ok) {
            return response.text();
        } else {
            throw new Error("HTTP " + response.status + " fetching " + url);
        }
    }
};

/**
 * Normalise parsed GeoJSON into a FeatureCollection holding at least one feature.
 * @param {Object} geojson - Parsed GeoJSON, which may be a FeatureCollection, a Feature or a bare geometry.
 * @return {Object} A GeoJSON FeatureCollection.
 */
const toFeatureCollection = function (geojson) {
    let features;
    if (geojson.type === "FeatureCollection") {
        features = geojson.features;
    } else if (geojson.type === "Feature") {
        features = [geojson];
    } else {
        features = [{type: "Feature", properties: {}, geometry: geojson}];
    }
    if (Array.isArray(features) && features.length > 0) {
        return {type: "FeatureCollection", features};
    } else {
        throw new Error("Boundary GeoJSON holds no features");
    }
};

/**
 * Derive a project title from its markdown description, using the first level-one heading if there is one.
 * @param {String} markdown - The project's markdown description.
 * @param {String} fallback - The title to use if the markdown has no level-one heading.
 * @return {String} The project's title.
 */
const titleFromMarkdown = function (markdown, fallback) {
    const match = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown);
    return match ? match[1] : fallback;
};

/**
 * Retrieve the repository URL from a project's entry in projects.json.
 * @param {String|Object} entry - The project's entry - either its repository URL, or an object holding it as `repo`.
 * @return {String} The project's GitHub repository URL.
 */
const entryRepoUrl = function (entry) {
    return typeof entry === "string" ? entry : entry.repo;
};

/**
 * Collect the description and any boundary of a project or dataset from its folder within this repository.
 * @param {Object} entry - The item's entry in projects.json, with members `dir` holding the path of its folder relative
 * to this repository, `siteUrl` holding the URL that its title links to, and `place` holding the id of its place.
 * @param {String} boundaryFile - The name of the boundary file within the folder, which may be absent.
 * @param {String} descriptionFile - The name of the markdown description within the folder.
 * @return {Promise<Object>} A promise for the item's record, whose `boundary` is null if it has no boundary file.
 */
const collectLocal = async function (entry, boundaryFile, descriptionFile) {
    const dir = path.join(rootDir, entry.dir);
    const description = await fs.readFile(path.join(dir, descriptionFile), "utf8");
    let boundary = null;
    try {
        boundary = toFeatureCollection(JSON.parse(await fs.readFile(path.join(dir, boundaryFile), "utf8")));
    } catch (e) {
        if (e.code !== "ENOENT") {
            throw e;
        }
    }
    return {
        id: path.basename(entry.dir),
        title: entry.title || titleFromMarkdown(description, path.basename(entry.dir)),
        siteUrl: entry.siteUrl,
        place: entry.place,
        description,
        boundary
    };
};

/**
 * Collect the boundary and description of a single project.
 * @param {String|Object} entry - The project's entry in projects.json - either its GitHub repository URL, or an object
 * with members `repo` holding that URL, optionally `siteUrl` overriding the URL computed for its published site, and
 * `place` holding the id of its place, and optionally `title` overriding the title taken from its description and
 * `description` overriding the description itself. An object
 * with `dir` in place of `repo` names a folder within this repository
 * holding the project's description and, optionally, its boundary.
 * @param {Object} config - The parsed contents of projects.json.
 * @param {String|null} localDir - A directory holding local checkouts of the repositories, or null to fetch from GitHub.
 * @return {Promise<Object>} A promise for the project's record in data/projects.json.
 */
const collectProject = async function (entry, config, localDir) {
    if (entry.dir) {
        return collectLocal(entry, config.boundaryFile, config.descriptionFile);
    }
    const repo = parseRepoUrl(entryRepoUrl(entry));
    const [boundaryText, description] = await Promise.all([
        readProjectFile(repo, config.boundaryFile, localDir),
        readProjectFile(repo, config.descriptionFile, localDir)
    ]);
    return {
        id: repo.name,
        title: entry.title || titleFromMarkdown(description, repo.name),
        repoUrl: "https://github.com/" + repo.owner + "/" + repo.name,
        siteUrl: entry.siteUrl || pagesUrl(repo),
        place: entry.place,
        description: entry.description || description,
        boundary: toFeatureCollection(JSON.parse(boundaryText))
    };
};

/**
 * Read the previously collected projects, if any, indexed by repository URL.
 * @return {Promise<Object<String, Object>>} A promise for a map of repository URL to previously collected project record.
 */
const readPrevious = async function () {
    let previous = {};
    try {
        const records = JSON.parse(await fs.readFile(outputPath, "utf8"));
        previous = Object.fromEntries(records.map(record => [record.repoUrl, record]));
    } catch (e) {
        if (e.code !== "ENOENT") {
            console.warn("Ignoring unreadable " + outputPath + ": " + e.message);
        }
    }
    return previous;
};

/**
 * Collect all projects, datasets and places listed in projects.json and write them to data/projects.json,
 * data/datasets.json and data/places.json.
 * @return {Promise} A promise which resolves when all three files have been written.
 */
const main = async function () {
    const localIndex = process.argv.indexOf("--local");
    const localDir = localIndex === -1 ? null : path.resolve(process.argv[localIndex + 1] ?? "..");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    const previous = await readPrevious();

    const results = await Promise.allSettled(config.projects.map(entry => collectProject(entry, config, localDir)));
    const records = results.flatMap((result, i) => {
        const entry = config.projects[i];
        const source = entry.dir || entryRepoUrl(entry);
        let record;
        if (result.status === "fulfilled") {
            record = result.value;
            console.log("Collected " + record.title + " from " + source);
        } else {
            const prior = entry.dir ? null : previous["https://github.com/" + Object.values(parseRepoUrl(source)).join("/")];
            console.warn("Failed to collect " + source + ": " + result.reason.message +
                (prior ? " - retaining previously collected version" : " - omitting from map"));
            // A retained record takes its place and any title from the current configuration, in case they have changed
            record = prior && {...prior, place: entry.place, ...(entry.title && {title: entry.title}),
                ...(entry.description && {description: entry.description})};
        }
        return record ? [record] : [];
    });

    const islandPlaces = new Set(config.places.filter(place => place.islands).map(place => place.id));
    const dropIslandBoundary = record => islandPlaces.has(record.place) ? {...record, boundary: null} : record;
    records.splice(0, records.length, ...records.map(dropIslandBoundary));

    await fs.mkdir(path.dirname(outputPath), {recursive: true});
    await fs.writeFile(outputPath, JSON.stringify(records, null, 2) + "\n");
    console.log("Wrote " + records.length + " project(s) to " + path.relative(rootDir, outputPath));

    // Datasets are held within this repository, so any failure to read one is an error to be fixed rather than retried
    const datasets = (await Promise.all((config.datasets || []).map(entry =>
        collectLocal(entry, config.boundaryFile, config.datasetDescriptionFile)))).map(dropIslandBoundary);
    await fs.writeFile(datasetsOutputPath, JSON.stringify(datasets, null, 2) + "\n");
    console.log("Wrote " + datasets.length + " dataset(s) to " + path.relative(rootDir, datasetsOutputPath));

    const placeIds = new Set(config.places.map(place => place.id));
    [...records, ...datasets].filter(record => !placeIds.has(record.place)).forEach(record =>
        console.warn("Warning: " + record.title + " belongs to unknown place " + JSON.stringify(record.place) +
            " - it will not be shown"));
    await fs.writeFile(placesOutputPath, JSON.stringify(config.places, null, 2) + "\n");
    console.log("Wrote " + config.places.length + " place(s) to " + path.relative(rootDir, placesOutputPath));
};

main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
