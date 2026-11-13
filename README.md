# Salish Sea Biodiversity Atlas

The index site for IMERSS biodiversity projects in the Salish Sea, published at
https://imerss.github.io/salish-sea-biodiversity/.

The site shows a map of the Salish Sea with the boundary of each cooperating project drawn on it. Hovering a project's
boundary shows its description, and clicking it browses to the project's own site. Each project lives in its own
repository and shares this site's navigation banner, whose top left links back here.

## Places

Projects and datasets are organised by place. The map outlines each place with the boundaries of the projects (or, in
the Data section, datasets) within it, and the Projects and Data pages list them beneath its name. Places are listed
under `places` in [`projects.json`](projects.json), each with an `id` and a `name`, in the order they appear on those
pages. Every project and dataset names its place by id in its entry's `place`. A place with nothing in it on a given
page is left out of that page and its map.

A place may also give an `acknowledgement` of the peoples in whose territories it lies, which is shown once beneath
the projects or datasets listed under it, and may list `islands` from
[`data/geography/Salish_Sea_Islands.kml`](data/geography/Salish_Sea_Islands.kml). A place made of islands, such as
`{"id": "southern-gulf-islands", "name": "Southern Gulf Islands", "islands": ["Galiano Island", "Mayne Island", ...]}`,
is outlined by those islands alone, and the projects and datasets within it need no boundary of their own.

## Adding a project


A project repository must:

* publish its site with GitHub Pages from its `docs/` directory, so that it appears at
  `https://<owner>.github.io/<repository>/`
* hold at its top level
  * `boundary.geojson` - the project boundary as a GeoJSON FeatureCollection, Feature or geometry in WGS84 longitude/latitude,
    unless its place is made of islands
  * `project.md` - a short markdown description of the project. Its first `#` heading is used as the project's title
* to show the shared navigation banner, copy [`layouts/partials/navbar.html`](layouts/partials/navbar.html) and the
  "Shared navigation banner" rules from [`static/css/custom.css`](static/css/custom.css), and set in its `hugo.yaml`:

```yaml
params:
  indexSite:
    title: Salish Sea Biodiversity Atlas
    url: "https://imerss.github.io/salish-sea-biodiversity/"
```

Then add the project to the `projects` list in [`projects.json`](projects.json), giving its repository and place, for
example `{"repo": "https://github.com/IMERSS/saanich-peninsula-flora", "place": "saanich-peninsula"}`, and rebuild this
site. A project links to `https://<owner>.github.io/<repository>/story`. If its site lives elsewhere, give its address
as `siteUrl` too. A project's entry may also give a `title` or `description` to use in place of those in its
`project.md`. For example
`{"repo": "https://github.com/IMERSS/detecting-local-extinction", "siteUrl": "https://imerss.github.io/detecting-local-extinction/docs/", "place": "galiano-island"}`.

A project whose repository doesn't hold these files may instead be described in a folder under [`projects/`](projects)
of this repository, holding `project.md` and, optionally, `boundary.geojson` - without one, the project is shown within
its place's outline drawn from its other projects. List it as
`{"dir": "projects/xetthecum-ecocultural-mapping", "siteUrl": "https://imerss.github.io/xetthecum-storymap/", "place": "galiano-island"}`.

To thank a project's funders below its entry on the Projects page, add the project's id to
[`data/funders.yaml`](data/funders.yaml) with a sentence of thanks and the keys of their logos in
[`data/logos.yaml`](data/logos.yaml). Logo files go in `static/images/logos/` - imerss.org's repository holds logos for
many of IMERSS's funders and partners, with their entries in its own `data/logos.yaml`.

## Adding a dataset

Datasets are shown on the map in the Data section in place of the projects, and listed by place on the Data page. Unlike
projects, a dataset's files are held in this repository, in a folder under [`data/`](data):

* `boundary.geojson` - the area the dataset covers, as for a project, unless its place is made of islands
* `dataset.md` - a short markdown description of the dataset. Its first `#` heading is used as the dataset's title

Add the folder, the URL its title links to and its place under `datasets` in [`projects.json`](projects.json), for
example
`{"dir": "data/salish-sea-diatoms", "siteUrl": "https://www.gbif.org/dataset/d41f9582-0b3e-4062-8ee0-31f0ba52ace1", "place": "salish-sea"}`,
and rebuild this site.

### Where the files live

All data lives in [`data/`](data):

* **Datasets:** each dataset has a folder holding its `dataset.md`, any `boundary.geojson`, and its data. Related datasets
  may share a parent folder, as the Janszen journals share
  [`data/janszen-legacy-project/`](data/janszen-legacy-project), which holds the transcriptions exactly as delivered.
* **Geography:** [`data/geography/Salish_Sea_Islands.kml`](data/geography/Salish_Sea_Islands.kml) holds the islands of the
  Salish Sea, which outline the places.
* **Site tables:** the `.json` and `.yaml` files at the top of `data/` are what the site reads. They are generated by
  `npm run collect` and `npm run occurrences`, apart from `funders.yaml` and `logos.yaml`, which are written by hand. Hugo
  is configured in `hugo.yaml` to read only these top-level files.

The map layers and downloads generated from the data are served from `static/data/`.

### Datasets held here

A dataset whose records are held in this repository is drawn on the map record by record, wherever its records fall,
when it is opened on the Data page. Its entry names its place and its files under `occurrences`:

```json
{"dir": "data/janszen-legacy-project/janszen-journal-5", "siteUrl": "...", "place": "southern-gulf-islands",
 "occurrences": {"files": ["data/janszen-legacy-project/hj5-for-canadensys_2026_10_06.txt"]}}
```

[`scripts/build-occurrences.js`](scripts/build-occurrences.js) (`npm run occurrences`) writes the records to
`static/data/occurrences/<dataset>.geojson` and offers each source file for download unchanged from
`static/data/downloads/<dataset>/`. Records whose coordinates don't lie on the island named in their `island` column are
listed in the dataset folder's `island-check.csv` for review.

### Datasets published through GBIF

A dataset published through GBIF links to its GBIF page by GBIF's logo. To show the distribution of its records, name a
table of them in the dataset's entry as `sites`, either a CSV held in its folder or the occurrence file of its Darwin Core
Archive downloaded from GBIF (`dwca-*` folders are too large for this repository and are ignored by git):

```json
{"dir": "data/salish-sea-diatoms", "siteUrl": "https://www.gbif.org/dataset/...", "place": "salish-sea",
 "sites": {"file": "data/salish-sea-diatoms/oo_1598030.csv", "download": true}}
```

`npm run occurrences` summarises the records into one point per sampling site, sized by its number of records, in
`static/data/sites/<dataset>.geojson`. With `"download": true` the table is also offered as a CSV. Without the file, the
sites built from it previously are kept.

### Using the Data page

The list beside the map is its main control: hovering a place highlights it on the map, clicking its name opens it and
brings it into view, hovering a dataset previews its records or sites there, and expanding the dataset keeps them
shown. Clicking a record or site on the map shows its details.

Places may overlap, as Galiano Island lies within the Salish Sea. The map draws larger places beneath smaller ones, and
where they overlap, the pointer selects the smallest.

## Building

You need [Hugo](https://gohugo.io/installation/) (the site was built with 0.121.0) and [node](https://nodejs.org/) 18 or later.

```shell
npm run collect      # fetch boundary.geojson and project.md from each project's default branch into data/projects.json
npm run occurrences  # build place outlines, record points, sampling sites and downloads from the folders in data/
hugo              # build the site into docs/
```

`npm run build` runs all three steps. If a project's files can't be fetched, the copy collected previously is kept, so
commit `data/projects.json` along with `docs/`. To collect from local checkouts held next to this one instead of from
GitHub, for example to preview changes to a project that haven't been merged yet, run
`node scripts/collect-projects.js --local ..`

The initial map view and the version of [MapLibre GL JS](https://maplibre.org/) used are set under `params.projectMap`
in [`hugo.yaml`](hugo.yaml).
