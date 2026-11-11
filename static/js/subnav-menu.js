"use strict";

/*
 * Opens and closes the subnav's hamburger menu, which is shown in place of the subnav's menu items on narrow screens.
 * The menu closes on a click outside it or on pressing Escape.
 */

const imerssMenuButton = document.querySelector(".imerss-hamburger");
const imerssMenuPanel = document.getElementById("imerss-mobile-menu");

/**
 * Open or close the hamburger menu.
 * @param {Boolean} open - Whether the menu is to be open.
 */
const imerssSetMenuOpen = function (open) {
    imerssMenuPanel.hidden = !open;
    imerssMenuButton.setAttribute("aria-expanded", String(open));
    // hextra's hamburger icon animates into a cross when its svg has class "open"
    imerssMenuButton.querySelector("svg").classList.toggle("open", open);
};

imerssMenuButton.addEventListener("click", () => {
    imerssSetMenuOpen(imerssMenuPanel.hidden);
});

document.addEventListener("click", e => {
    if (imerssMenuPanel.contains(e.target) || imerssMenuButton.contains(e.target)) {
        // Leave the menu as it is for clicks on its own button or within it
    } else {
        imerssSetMenuOpen(false);
    }
});

document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !imerssMenuPanel.hidden) {
        imerssSetMenuOpen(false);
        imerssMenuButton.focus();
    }
});

/*
 * A subnav item with children is a button which opens their dropdown when clicked, as well as on hover or focus. The
 * dropdown closes on a click outside it or on pressing Escape.
 */
document.querySelectorAll(".imerss-subnav-dropdown-toggle").forEach(toggle => {
    const dropdown = toggle.closest(".imerss-subnav-dropdown");
    const setOpen = open => {
        dropdown.classList.toggle("imerss-open", open);
        toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => setOpen(!dropdown.classList.contains("imerss-open")));
    document.addEventListener("click", e => {
        if (!dropdown.contains(e.target)) {
            setOpen(false);
        }
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && dropdown.classList.contains("imerss-open")) {
            setOpen(false);
            toggle.focus();
        }
    });
});
