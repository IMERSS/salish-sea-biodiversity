"use strict";

/*
 * Turns each entry of a project or dataset list into an accordion entry. Entries start collapsed to their titles.
 * Clicking the title of a collapsed entry expands it, and clicking the title of an expanded entry follows its link.
 * The chevron button beside each title expands or collapses its entry. Without this script, every entry is shown in
 * full.
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
