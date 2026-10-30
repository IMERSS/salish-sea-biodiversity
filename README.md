# Salish Sea Biodiversity Atlas

The index site for IMERSS biodiversity projects in the Salish Sea, published at
https://imerss.github.io/salish-sea-biodiversity/.

The site shows a map of the Salish Sea with the boundary of each cooperating project drawn on it. Hovering a project's
boundary shows its description, and clicking it browses to the project's own site. Each project lives in its own
repository and shares this site's navigation banner, whose top left links back here.

## Adding a project

A project repository must:

* publish its site with GitHub Pages from its `docs/` directory, so that it appears at
  `https://<owner>.github.io/<repository>/`
* hold at its top level
  * `boundary.geojson` - the project boundary as a GeoJSON FeatureCollection, Feature or geometry in WGS84 longitude/latitude
  * `project.md` - a short markdown description of the project. Its first `#` heading is used as the project's title
* to show the shared navigation banner, copy [`layouts/partials/navbar.html`](layouts/partials/navbar.html) and the
  "Shared navigation banner" rules from [`static/css/custom.css`](static/css/custom.css), and set in its `hugo.yaml`:

```yaml
params:
  indexSite:
    title: Salish Sea Biodiversity Atlas
    url: "https://imerss.github.io/salish-sea-biodiversity/"
```

Then add the project's repository URL to the `projects` list in [`projects.json`](projects.json) and rebuild this site.
The map links each project to `https://<owner>.github.io/<repository>/story`. If a project's site lives elsewhere, list
it as an object giving its address too, for example
`{"repo": "https://github.com/IMERSS/detecting-local-extinction", "siteUrl": "https://imerss.github.io/detecting-local-extinction/docs/"}`.

To thank a project's funders below its entry on the Projects page, add the project's id to
[`data/funders.yaml`](data/funders.yaml) with a sentence of thanks and the keys of their logos in
[`data/logos.yaml`](data/logos.yaml). Logo files go in `static/images/logos/` - imerss.org's repository holds logos for
many of IMERSS's funders and partners, with their entries in its own `data/logos.yaml`.

## Adding a dataset

Datasets are shown on the map in the Data section in place of the projects, and listed on the Data page. Unlike
projects, a dataset's files are held in this repository, in a folder under [`datasets/`](datasets):

* `boundary.geojson` - the area the dataset covers, as for a project
* `dataset.md` - a short markdown description of the dataset. Its first `#` heading is used as the dataset's title

Add the folder and the URL its title and boundary link to under `datasets` in [`projects.json`](projects.json), for example
`{"dir": "datasets/salish-sea-diatoms", "siteUrl": "https://www.gbif.org/dataset/d41f9582-0b3e-4062-8ee0-31f0ba52ace1"}`,
and rebuild this site.

Boundaries may overlap, as a dataset for one island may lie within one for the whole Salish Sea. The map draws larger
boundaries beneath smaller ones, and where they overlap, the pointer selects the smallest.

## Building

You need [Hugo](https://gohugo.io/installation/) (the site was built with 0.121.0) and [node](https://nodejs.org/) 18 or later.

```shell
npm run collect   # fetch boundary.geojson and project.md from each project's default branch into data/projects.json
hugo              # build the site into docs/
```

`npm run build` runs both steps. If a project's files can't be fetched, the copy collected previously is kept, so
commit `data/projects.json` along with `docs/`. To collect from local checkouts held next to this one instead of from
GitHub, for example to preview changes to a project that haven't been merged yet, run
`node scripts/collect-projects.js --local ..`

The initial map view and the version of [MapLibre GL JS](https://maplibre.org/) used are set under `params.projectMap`
in [`hugo.yaml`](hugo.yaml).
