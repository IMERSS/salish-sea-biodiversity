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

A place may also give an `acknowledgement` of the peoples in whose territories it lies, which is shown with each
project or dataset within it.

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

Then add the project to the `projects` list in [`projects.json`](projects.json), giving its repository and place, for
example `{"repo": "https://github.com/IMERSS/saanich-peninsula-flora", "place": "saanich-peninsula"}`, and rebuild this
site. A project links to `https://<owner>.github.io/<repository>/story`. If its site lives elsewhere, give its address
as `siteUrl` too, for example
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
projects, a dataset's files are held in this repository, in a folder under [`datasets/`](datasets):

* `boundary.geojson` - the area the dataset covers, as for a project
* `dataset.md` - a short markdown description of the dataset. Its first `#` heading is used as the dataset's title

Add the folder, the URL its title links to and its place under `datasets` in [`projects.json`](projects.json), for
example
`{"dir": "datasets/salish-sea-diatoms", "siteUrl": "https://www.gbif.org/dataset/d41f9582-0b3e-4062-8ee0-31f0ba52ace1", "place": "salish-sea"}`,
and rebuild this site.

Places may overlap, as Galiano Island lies within the Salish Sea. The map draws larger places beneath smaller ones, and
where they overlap, the pointer selects the smallest.

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
