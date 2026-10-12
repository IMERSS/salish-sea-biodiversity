# Biodiversity Change in the Salish Sea

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
  "Shared navigation banner" rules from [`assets/css/custom.css`](assets/css/custom.css), and set in its `hugo.yaml`:

```yaml
params:
  indexSite:
    title: Biodiversity Change in the Salish Sea
    url: "https://imerss.github.io/salish-sea-biodiversity/"
```

Then add the project's repository URL to the `projects` list in [`projects.json`](projects.json) and rebuild this site.

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
