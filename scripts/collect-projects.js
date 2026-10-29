/* eslint-env node */

"use strict";

/*
 * Collects the boundary GeoJSON and markdown description from the top level of each subsidiary project repository
 * listed in projects.json, and writes them to data/projects.json for the Hugo build to render onto the index map.
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
 * Collect the boundary and description of a single project.
 * @param {String|Object} entry - The project's entry in projects.json - either its GitHub repository URL, or an object
 * with members `repo` holding that URL and optionally `siteUrl` overriding the URL computed for its published site.
 * @param {Object} config - The parsed contents of projects.json.
 * @param {String|null} localDir - A directory holding local checkouts of the repositories, or null to fetch from GitHub.
 * @return {Promise<Object>} A promise for the project's record in data/projects.json.
 */
const collectProject = async function (entry, config, localDir) {
    const repo = parseRepoUrl(entryRepoUrl(entry));
    const [boundaryText, description] = await Promise.all([
        readProjectFile(repo, config.boundaryFile, localDir),
        readProjectFile(repo, config.descriptionFile, localDir)
    ]);
    return {
        id: repo.name,
        title: titleFromMarkdown(description, repo.name),
        repoUrl: "https://github.com/" + repo.owner + "/" + repo.name,
        siteUrl: entry.siteUrl || pagesUrl(repo),
        description,
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
 * Collect all projects listed in projects.json and write them to data/projects.json.
 * @return {Promise} A promise which resolves when data/projects.json has been written.
 */
const main = async function () {
    const localIndex = process.argv.indexOf("--local");
    const localDir = localIndex === -1 ? null : path.resolve(process.argv[localIndex + 1] ?? "..");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    const previous = await readPrevious();

    const results = await Promise.allSettled(config.projects.map(repoUrl => collectProject(repoUrl, config, localDir)));
    const records = results.flatMap((result, i) => {
        const repoUrl = entryRepoUrl(config.projects[i]);
        let record;
        if (result.status === "fulfilled") {
            record = result.value;
            console.log("Collected " + record.title + " from " + repoUrl);
        } else {
            const prior = previous["https://github.com/" + Object.values(parseRepoUrl(repoUrl)).join("/")];
            console.warn("Failed to collect " + repoUrl + ": " + result.reason.message +
                (prior ? " - retaining previously collected version" : " - omitting from map"));
            record = prior;
        }
        return record ? [record] : [];
    });

    await fs.mkdir(path.dirname(outputPath), {recursive: true});
    await fs.writeFile(outputPath, JSON.stringify(records, null, 2) + "\n");
    console.log("Wrote " + records.length + " project(s) to " + path.relative(rootDir, outputPath));
};

main().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
