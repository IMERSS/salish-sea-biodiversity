"use strict";

/*
 * Turns each entry of a project or dataset list into an accordion entry. Entries start collapsed to their titles.
 * Clicking the title of a collapsed entry expands it, and clicking the title of an expanded entry follows its link,
 * which opens in a new tab. The chevron button beside each title expands or collapses its entry. Without this script,
 * every entry is shown in full.
 *
 * A place's section in the list can be opened - selected, with its entries expanded and those of other places
 * collapsed, and scrolled into view - by clicking the place on the map, which dispatches an "imerss-open-place" event
 * on the document holding the place's id, or by arriving at the page with a URL fragment naming the place's heading.
 */

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
 * Open a place's section in the list, expanding its entries, collapsing those of other places, and scrolling it into
 * view.
 * @param {String} id - The place's id, as held in its section's `data-map-id`.
 * @param {Boolean} [smooth] - Whether to scroll smoothly rather than jumping.
 */
const imerssOpenPlace = function (id, smooth) {
    const sections = [...document.querySelectorAll(".imerss-place[data-map-id]")];
    const target = sections.find(section => section.dataset.mapId === id);
    if (target) {
        sections.forEach(section => {
            const selected = section === target;
            section.classList.toggle("imerss-selected", selected);
            section.querySelectorAll(".imerss-project-list-item").forEach(item => imerssSetExpanded(item, selected));
        });
        target.scrollIntoView({behavior: smooth ? "smooth" : "auto", block: "start"});
    }
};

document.querySelectorAll(".imerss-project-list-item").forEach(item => {
    imerssSetExpanded(item, false);
    item.querySelector(".imerss-project-list-toggle").addEventListener("click", () => {
        imerssSetExpanded(item, !item.classList.contains("imerss-expanded"));
    });
    item.querySelector(".imerss-project-list-title").addEventListener("click", e => {
        // Let modified clicks open the link in a new tab or window as usual
        const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
        if (!modified && !item.classList.contains("imerss-expanded")) {
            e.preventDefault();
            imerssSetExpanded(item, true);
        }
    });
});

document.addEventListener("imerss-open-place", e => imerssOpenPlace(e.detail.id, true));

// A URL fragment naming a place's heading, as linked to from the map on other pages, opens that place
const imerssPlaceFragment = /^#imerss-place-(.+)$/.exec(window.location.hash);
if (imerssPlaceFragment) {
    imerssOpenPlace(decodeURIComponent(imerssPlaceFragment[1]), false);
}
