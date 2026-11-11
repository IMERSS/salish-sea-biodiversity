"use strict";

/*
 * The list of places beside the map. Clicking a place's name opens it and collapses the others; within it, each project
 * or dataset is an accordion entry. Hovering or expanding a dataset with records for the place draws them on the map.
 * The list talks to the map through "imerss-place-opened", "imerss-preview-occurrences" and "imerss-show-occurrences"
 * events. A URL fragment #imerss-place-<place>[/<entry>] opens a place, and optionally one of its entries.
 */

let imerssShownItem = null;

/**
 * Expand or collapse a list entry.
 * @param {HTMLElement} item - The entry's `.imerss-project-list-item` element.
 * @param {Boolean} expanded - Whether the entry is to be expanded.
 */
const imerssSetExpanded = function (item, expanded) {
    item.classList.toggle("imerss-expanded", expanded);
    item.querySelector(".imerss-project-list-toggle").setAttribute("aria-expanded", String(expanded));
    item.querySelector(".imerss-project-list-body").hidden = !expanded;
};

/**
 * Show a dataset entry's records on the map, keeping them shown, or clear them.
 * @param {HTMLElement|null} item - The entry's `.imerss-project-list-item` element, or null to clear any records shown.
 */
const imerssShowItem = function (item) {
    if (imerssShownItem) {
        imerssShownItem.classList.remove("imerss-occurrences-shown");
    }
    imerssShownItem = item;
    if (item) {
        item.classList.add("imerss-occurrences-shown");
    }
    document.dispatchEvent(new CustomEvent("imerss-show-occurrences", {detail: item ? imerssItemDetail(item) : {url: null}}));
};

/**
 * The detail of an event telling the map about a dataset entry's records.
 * @param {HTMLElement} item - The entry's `.imerss-project-list-item` element.
 * @return {Object} An object with `url` holding the records' URL and `label` naming the dataset.
 */
const imerssItemDetail = function (item) {
    return {url: item.dataset.occurrencesUrl, label: item.querySelector(".imerss-project-list-title").textContent.trim()};
};

/**
 * Open or close a place's section in the list. Opening it collapses every other place, and expands the place's entries
 * if it holds only one.
 * @param {HTMLElement} target - The place's `.imerss-place` section.
 * @param {Boolean} open - Whether the place is to be opened.
 * @param {Object} [options] - `scroll` to scroll the section into view, and `smooth` to do so smoothly.
 */
const imerssSetPlaceOpen = function (target, open, options = {}) {
    document.querySelectorAll(".imerss-place[data-map-id]").forEach(section => {
        const selected = open && section === target;
        section.classList.toggle("imerss-selected", selected);
        section.querySelector(".imerss-place-toggle")?.setAttribute("aria-expanded", String(selected));
        section.querySelector(".imerss-project-list").hidden = !selected;
        const items = [...section.querySelectorAll(".imerss-project-list-item")];
        items.forEach(item => imerssSetExpanded(item, selected && items.length === 1));
        if (selected && items.length === 1 && items[0].dataset.occurrencesUrl) {
            imerssShowItem(items[0]);
        } else if (!selected && imerssShownItem && section.contains(imerssShownItem)) {
            imerssShowItem(null);
        }
    });
    if (open && options.scroll) {
        target.scrollIntoView({behavior: options.smooth ? "smooth" : "auto", block: "start"});
    }
    document.dispatchEvent(new CustomEvent("imerss-place-opened", {detail: {id: open ? target.dataset.mapId : null}}));
};

/**
 * Open a place's section in the list, by its id.
 * @param {String} id - The place's id, as held in its section's `data-map-id`.
 * @param {Boolean} [smooth] - Whether to scroll smoothly rather than jumping.
 */
const imerssOpenPlace = function (id, smooth) {
    const target = document.querySelector(".imerss-place[data-map-id=\"" + CSS.escape(id) + "\"]");
    if (target) {
        imerssSetPlaceOpen(target, true, {scroll: true, smooth});
    }
};

document.querySelectorAll(".imerss-place[data-map-id]").forEach(section => {
    section.querySelector(".imerss-project-list").hidden = true;
    section.querySelector(".imerss-place-toggle")?.setAttribute("aria-expanded", "false");
    section.querySelector(".imerss-place-toggle")?.addEventListener("click", () => {
        imerssSetPlaceOpen(section, !section.classList.contains("imerss-selected"));
    });
});

document.querySelectorAll(".imerss-project-list-item").forEach(item => {
    imerssSetExpanded(item, false);
    const hasOccurrences = Boolean(item.dataset.occurrencesUrl);
    const setExpanded = expanded => {
        imerssSetExpanded(item, expanded);
        if (hasOccurrences && expanded) {
            imerssShowItem(item);
        } else if (hasOccurrences && imerssShownItem === item) {
            imerssShowItem(null);
        }
    };
    item.querySelector(".imerss-project-list-toggle").addEventListener("click", () => {
        setExpanded(!item.classList.contains("imerss-expanded"));
    });
    item.querySelector(".imerss-project-list-title").addEventListener("click", e => {
        // Let modified clicks open the link in a new tab or window as usual
        const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
        if (!modified && !item.classList.contains("imerss-expanded")) {
            e.preventDefault();
            setExpanded(true);
        }
    });
    if (hasOccurrences) {
        item.addEventListener("mouseenter", () => document.dispatchEvent(
            new CustomEvent("imerss-preview-occurrences", {detail: imerssItemDetail(item)})));
        item.addEventListener("mouseleave", () => document.dispatchEvent(
            new CustomEvent("imerss-preview-occurrences", {detail: {url: null}})));
    }
});

document.addEventListener("imerss-open-place", e => imerssOpenPlace(e.detail.id, true));

// A URL fragment naming a place's heading, as linked to from the map on other pages, opens that place
const imerssPlaceFragment = /^#imerss-place-([^/]+)(?:\/(.+))?$/.exec(window.location.hash);
if (imerssPlaceFragment) {
    window.addEventListener("load", () => {
        const placeId = decodeURIComponent(imerssPlaceFragment[1]);
        imerssOpenPlace(placeId, false);
        const itemId = imerssPlaceFragment[2] && decodeURIComponent(imerssPlaceFragment[2]);
        const item = itemId && document.querySelector(".imerss-place[data-map-id=\"" + CSS.escape(placeId) +
            "\"] .imerss-project-list-item[data-item-id=\"" + CSS.escape(itemId) + "\"]");
        if (item) {
            if (!item.classList.contains("imerss-expanded")) {
                item.querySelector(".imerss-project-list-toggle").click();
            }
            item.scrollIntoView({block: "start"});
        }
    });
}
