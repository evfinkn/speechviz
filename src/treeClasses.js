// I really hate to put all of these classes in one file, but there was an issue with
// webpack where TreeItem.byId would be an empty object when accessed from Popup even
// though it definitely wasn't empty (log statements showed this), so need to all be in
// one file so that webpack doesn't mess up with imports. 
// Note that before moving to this solution, I made sure there weren't any circular
// dependencies, but it didn't solve the issue.

// Another note: even though Segment and Group both use Popups, I didn't want to put
// Popup in TreeItem because I didn't want to hard-code `GroupOfGroups`s being expanded
// into `Group`s. In other words, it's
// possible someone may want to be able to move something to a `GroupOfGroups` (and
// therefore not expand the `GroupOfGroups`s into `Group`s within Popup), so didn't want
// to hard-code it into TreeItem. Probably better way to do this while still including
// Popup functionality in TreeItem?

import Picker from "vanilla-picker";
import globals from "./globals";
import {
    htmlToElement,
    sortByProp,
    toggleButton,
    arrayMean,
    objectMap,
    propertiesEqual,
    getRandomColor
} from "./util";
import { groupIcons, segmentIcons } from "./icon";

const peaks = globals.peaks;
const undoStorage = globals.undoStorage;
// const redoStorage = globals.redoStorage;

// typedefs (used for JSDoc, can help explain types)
/**
 * A hex string in the form "#RRGGBB" that represents a color.
 * @typedef {string} Color
 */

/** @typedef {import("Peaks").Segment} Peaks.Segment */
// TODO: make typedef for an options type

/**
 * Expands an array consisting of `Group`s and `GroupOfGroups` by recursiving replacing
 * `GroupOfGroups` with their children until all items are `Group`s.
 * @param {!Array.<Group|GroupOfGroups>} groups - Array of `Group`s and `GroupOfGroups`s to expand.
 * @param {?Array.<Group>=} exclude - Array of `Group`s to exclude from the expanded array.
 * @returns {!Array.<Group>} The expanded array of `Group`s.
 */
const expandGroups = function expand(groups, exclude = []) {
    const expanded = [];
    for (const group of groups) {
        if (group instanceof Group) {
            if (!exclude.includes(group.id)) { expanded.push(group); }
        }
        // array.push(...) is faster than array.concat()
        else { expanded.push(...expandGroups(group.children, exclude)); }
    }
    return expanded;
}

// instead of const use var so the classes hoist and can reference each other before definition
/**
 * An item in a tree.
 * Not intended to actually be used in the tree and instead acts as more of an abstract class.
 */
var TreeItem = class TreeItem {
    // While I think actually using this class in the tree in addition to its subclasses would work,
    // TreeItem isn't intended to be used in the tree and is more of an abstract class

    /** 
     * An object containing all `TreeItem`s by their id. 
     * Key is id, value is corresponding `TreeItem`:
     * {id: `TreeItem`}
     * @type {!Object.<string, TreeItem>}
     * @static
     */
    static byId = {};

    /**
     * HTML strings for the play, pause, loop, and remove icons for items in the tree.
     * @type {!Object.<string, string>}
     * @static
     */
    static icons = groupIcons;

    /**
     * Names of properties to get in `getProperties`.
     * @type {!string[]}
     * @see getProperties
     * @static
     */
    static properties = ["id", "text", "duration", "removable", "renamable", "path"];

    /** 
     * Checks if a `TreeItem` by the given id exists.
     * @param {string} id - The id to check the existence of.
     * @returns {boolean} `true` if a TreeItem with `id` exists. Otherwise, `false`.
     * @static
     */
    static exists(id) { return id in TreeItem.byId; }

    /**
     * Returns an array of `TreeItem`s with the given ids.
     * @param {!string[]} ids - Array of the ids of the `TreeItem`s to get.
     * @returns {!TreeItem[]} The `TreeItem`s corresponding to the ids.
     * @static
     */
    static idsToTreeItems(ids) { return ids.map(id => TreeItem.byId[id]); }

    /**
     * Returns an array of the ids of the given `TreeItem`s.
     * @param {!TreeItem[]} treeItems - Array of the `TreeItem`s whose ids to get.
     * @returns {!string[]} The ids corresponding to the given `TreeItem`s.
     * @static
     */
    static treeItemsToIds(treeItems) { return treeItems.map(treeItem => treeItem.id); }

    /**
     * The unique identifier of this item.
     * @type {string}
     */
    id;

    /**
     * The `TreeItem` that contains this item in its nested content.
     * `null` if this item is the root of the tree.
     * @type {?TreeItem}
     */
    #parent;

    /**
     * An array of `TreeItem`s contained in this item's nested content.
     * @type {!TreeItem[]}
     */
    children = [];

    /**
     * The text shown in `span` (and therefore in the tree).
     * This is hidden to differentiate between the getter and setter for `text`.
     * Can probably be removed by just changing getter and setter for `text` to only use
     * `span.innerHTML`.
     * @type {string}
     */
    #text;

    /**
     * How long this item's audio lasts in seconds.
     * @type {number}
     */
    duration = 0;

    /**
     * A `boolean` indicating if this item can be removed from the tree.
     * @type {boolean}
     */
    removable;

    /**
     * A `boolean` indicating if this item can be renamed.
     * @type {boolean}
     */
    renamable;

    // array of ids instead of TreeItems because some might be expanded
    // e.g. Segments and Groups aren't movable to GroupOfGroups, but can be movable any child of a
    // GroupOfGroups. Therefore, need to store id so that GroupOfGroups can be expanded into Groups
    // (the expansion of which will depend on when it's being expanded e.g. labels are added)
    /**
     * An array of the ids of `TreeItem`s that this item can be moved to.
     * `null` if this item isn't moveable.
     * @type {?string[]}
     */
    moveTo;

    /**
     * An array of the ids of `TreeItem`s that this item can be copied to.
     * `null` if this item isn't copyable.
     * @type {?string[]}
     */
    copyTo;

    /**
     * The li element that is displayed and that contains all other elements.
     * @type {!Element}
     */
    li;

    /**
     * The input element of the checkbox used to toggle this item.
     * @type {!Element}
     */
    checkbox;

    /**
     * The span element containing the text shown in `li`.
     * @type {!Element}
     */
    span;

    /**
     * The a element of the play button.
     * @type {!Element}
     */
    playButton;

    /**
     * The a element of the loop button.
     * @type {!Element}
     */
    loopButton;

    /**
     * The a element of the remove button.
     * `null` if this item isn't removable.
     * @type {?Element}
     */
    removeButton;

    /**
     * The `Popup` that is shown when this item (specifically `span`) is clicked.
     * `null` if this item doesn't have any properties shown in a `Popup`.
     * @type {?Popup}
     */
    popup;

    /**
     * The ul element containing the nested content (the children) of this item.
     * @type {!Element}
     */
    nested;

    /**
     * @param {string} id - The unique identifier to give the `TreeItem`.
     * @param {?Object.<string, any>=} options - Options to customize the `TreeItem`.
     * @param {?TreeItem=} options.parent - The `TreeItem` that contains the item in its nested
     *      content.
     * @param {?Array.<TreeItem>=} options.children - An array of `TreeItem`s to put in the item's
     *      nested content.
     * @param {string=} options.text - The text to show in the item's span (and therefore in the
     *      tree). If `null`, `id` is used.
     * @param {boolean} [options.removable=false] - Indicates if the item can be removed from the
     *      tree.
     * @param {boolean} [options.renamable=false] - Indicates if the item can be renamed.
     * @param {?Array.<string>=} [options.moveTo] - An array of the ids of `TreeItem`s that the
     *      item can be moved to. `null` if the item isn't moveable.
     * @param {?Array.<string>=} [options.copyTo] - An array of the ids of `TreeItem`s that the
     *      item be copied to. `null` if the item isn't copyable.
     * @param {boolean} [options.render=true] - If `true`, `render()` is called in the constructor.
     *      Otherwise, `render()` is not called and is left to the user to call.
     * @throws {Error} If a `TreeItem` with `id` already exists.
     */
    constructor(id, {
        parent = null,
        children = null,
        text = null,
        removable = false,
        renamable = false,
        moveTo = null,
        copyTo = null,
        render = true
    } = {}) {

        if (TreeItem.exists(id)) {
            throw new Error(`A TreeItem with the id ${id} already exists`);
        }

        TreeItem.byId[id] = this;

        this.id = id;

        this.#text = text || id;
        this.removable = removable;
        this.renamable = renamable;
        this.moveTo = moveTo;
        this.copyTo = copyTo;

        if (render) {
            this.render();
            // in if (render) because you can only assign to parent if its been rendered,
            // since this.li is appended to parent.nested but this.li is set in render
            if (parent) { this.parent = parent; }
        }

        if (children) { children.forEach(function (child) { child.parent = this; }); }
    }

    /**
     * The `TreeItem` that contains this item in its nested content.
     * `null` if this item is the root of the tree.
     * @type {?TreeItem}
     */
    get parent() { return this.#parent; }
    set parent(newParent) {
        if (this.#parent) {
            this.#parent.children = this.#parent.children.filter(child => child.id != this.id);
        }
        this.#parent = newParent;
        newParent.children.push(this);
        newParent.nested.append(this.li);
        newParent.updateDuration(this.duration);
    }

    /**
     * The text shown in `span` (and therefore in the tree).
     * @type {string}
     */
    get text() { return this.#text; }
    set text(newText) {  // setter for text so `this.text = newText` updates text in tree
        this.#text = newText;
        this.span.innerHTML = newText;
    }

    /**
     * A `boolean` indicating if this item's checkbox is checked.
     * Equivalent to `checkbox.checked`.
     * @type {boolean}
     */
    get checked() { return this.checkbox.checked; }
    set checked(bool) { this.checkbox.checked = bool; }

    /** 
     * `null` if this item doesn't have a parent. Otherwise, an array containing this item's parent,
     * this item's parent's parent, etc. Top-most parents are first in the array, with this item's
     * parent being last. For example, `[root, great-grandparent, grandparent, parent]`.
     * @type {?Array.<TreeItem>}
     */
    get path() {
        if (this.#parent) {
            const parentPath = this.#parent.path;
            if (parentPath) {
                parentPath.push(this.#parent.id);
                return parentPath;  // path is parent's path + parent
            }
            return [this.#parent.id];  // parent has no path, so path is just parent
        }
        return null;  // no parent, so no path
    }

    /**
     * Gets the properties of this item specified by `properties`.
     * @param {?Array.<string>=} exclude - Names of properties to exclude from the returned
     *      `Object`.
     * @returns {!Object.<string, any>} An `Object` containing this item's properties.
     * @see properties
     */
    getProperties(exclude = null) {
        exclude = exclude == null ? [] : exclude;
        const obj = {};
        TreeItem.properties.forEach(property => {
            if (!exclude.includes(property)) { obj[property] = this[property]; }
        });
        if (!(this.constructor == TreeItem)) {
            this.constructor.properties.forEach(property => {
                if (!exclude.includes(property)) { obj[property] = this[property]; }
            });
        }
        return obj;
    }

    /** Generates the HTML for this item. */
    render() {
        if (this.li) { this.li.remove(); }

        // since subclasses use this method, use this.constructor.icons to use the icons of
        // whatever class is being initialized (i.e. Group, TreeItem, Segment, etc.)
        const li = htmlToElement(`<li>
            <input type="checkbox" autocomplete="off" checked>
            <span>${this.#text}</span>
            <a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.play}</a>
            <a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.loop}</a>
            <ul class="nested active"></ul>
        </li>`);
        this.li = li;

        this.checkbox = li.firstElementChild;
        // event listeners need to use `() => {}` syntax instead of `function () {}` because
        // `() => {}` doesn't rebind `this` (`this` will still refer to the TreeItem)
        this.checkbox.addEventListener("click", () => { this.toggle(); });

        this.span = li.children[1];
        this.span.addEventListener("click", () => {
            if (this.popup) { this.popup.show(); }
        });
        this.updateSpanTitle();

        this.playButton = li.children[2];
        this.loopButton = li.children[3];
        // use { once: true } because this.play() re-adds the event listener
        this.playButton.addEventListener("click", () => { this.play(); }, { once: true });
        this.loopButton.addEventListener("click", () => { this.play(true); }, { once: true });

        this.nested = li.children[4];

        if (this.removable) {
            const remove =
                htmlToElement(`<a href="javascript:;" ">${this.constructor.icons.remove}</a>`);
            this.loopButton.after(remove);
            remove.addEventListener("click", () => { this.remove(); });
            this.removeButton = remove;
        }

        // this is here for subclasses to define a style method
        // if they want to apply specific CSS styles
        this.style?.();
    }

    /**
     * Updates `duration`.
     * @param {number} durationChange - The amount to change `duration` by. If negative,
     *      decreases `duration`. Otherwise, increases `duration`.
     */
    updateDuration(durationChange) {
        this.duration = this.duration + durationChange;
        this.updateSpanTitle();

        if (this.#parent) { this.#parent.updateDuration(durationChange); }
    }

    /** Updates the title (tooltip) of `span`. */
    updateSpanTitle() {
        this.span.title = `Duration: ${this.duration.toFixed(2)}`;
    }

    /** Removes this item and all of its children from the tree. */
    remove() {
        if (!this.removable) {
            throw new Error(`TreeItem ${this.id} is not removable.`);
        }

        this.li.remove();
        delete TreeItem.byId[this.id];
        delete this.constructor.byId[this.id];  // removes from subclasses byId, i.e. Group.byId
        this.children.forEach(function (child) { child.remove(); });
        if (this.#parent) {
            this.#parent.children = this.#parent.children.filter(child => child.id != this.id);
        }
    }

    /**
     * Renames this item, replacing its id and text in the tree.
     * @param {string} newId - The new id to give this item.
     * @throws {Error} If this item cannot be renamed.
     * @throws {Error} If a `TreeItem` with `newId` already exists.
     */
    rename(newId) {
        if (!this.renamable) {
            throw new Error(`TreeItem ${this.id} is not renamable.`);
        }
        if (TreeItem.exists(newId)) {
            throw new Error(`A TreeItem with the id ${newId} already exists`);
        }
        // delete the old name from the byId objects
        delete TreeItem.byId[this.id];
        delete this.constructor.byId[this.id];  // removes from subclasses byId, i.e. Group.byId
        // add the new name to the byId objects
        TreeItem.byId[newId] = this;
        this.constructor.byId[newId] = this;  // adds this to subclasses byId, i.e. Group.byId
        this.id = newId;
        this.text = newId;
    }

    /**
     * Sorts this item's children in the tree.
     * @param {string} by - The name of the property to sort by.
     */
    sort(by) {
        const nested = this.nested;
        const children = sortByProp(this.children, by);
        children.forEach(function (segment) { nested.append(segment.li); });
    }

    /**
     * Toggles this item's elements on / off.
     * Toggling on / off does the following:
     *  - Checks / unchecks `checkbox`.
     *  - Hides / unhides this item's nested content.
     *  - Makes `playButton`, `loopButton` and `removeButton` clickable / unclickable.
     *  - Colors `playButton`, `loopButton` and `removeButton` black / gray.
     * @param {boolean=} force - If unspecified, this item is always toggled. Otherwise, this item
     *      is only toggled if its current state isn't equal to `force`.
     * @returns {boolean} A `boolean` indiciating if any toggling was done. In other words, when
     *      `force == null`, returns `true`. Otherwise, returns `force !== checked`.
     */
    toggleTree(force = null) {
        if (force === this.checked) { return false; }

        const checked = force === null ? this.checked : force;
        this.checked = checked;

        this.nested.classList.toggle("active", checked);

        toggleButton(this.playButton, checked);
        toggleButton(this.loopButton, checked);
        if (this.removeButton) { toggleButton(this.removeButton, checked); }

        return true;
    }

    /**
     * Toggles this item on / off.
     * This is an alias for `toggleTree`.
     * @see toggleTree
     */
    toggle(force = null) { return this.toggleTree(force); }

    /**
     * Opens (unhides) this item's nested content and the nested content of each item in `path`.
     * This doesn't toggle any of the items; it only opens the tree along `path`.
     */
    open() {
        this.nested.classList.add("active");
        this.checked = true;
        if (this.#parent) { this.#parent.open(); }
    }
}

/** A popup to display when a `TreeItem` is clicked. */
var Popup = class Popup {

    /**
     * The `TreeItem` that uses this popup.
     * Properties of `treeItem` are used to determine the contents of this popup.
     * @type {!TreeItem}
     */
    treeItem;

    /**
     * The text shown in the headers of this popup's divs.
     * Always equals `treeItem.text`.
     * @type {string}
     */
    #text;

    /**
     * The div element that contains all other elements.
     * Displayed when `treeItem` is clicked (and this popup currently has content).
     * @type {!Element}
     */
    popup;

    // Honestly I'm not sure why popup and popupContent are separate, that's just the way Sarita
    // made it, so that's how I made the class. They might be able to be combined
    /**
     * The div element containing the actual content of the popup.
     * @type {!Element}
     */
    popupContent;

    /**
     * The div element containing `renameInput` if `treeItem.renamable`. Otherwise, `null`.
     * @type {?Element}
     */
    renameDiv;

    /**
     * The text input element used to rename `treeItem` if `treeItem.renamable`. Otherwise, `null`.
     * @type {?Element}
     */
    renameInput;

    /**
     * The div element containing the radio buttons used to move `treeItem` if `treeItem.moveTo`.
     * Otherwise, `null`.
     * @type {?Element}
     */
    moveDiv;

    /**
     * The div element containing the radio buttons used to move `treeItem` if `treeItem.copyTo`.
     * Otherwise, `null`.
     * @type {?Element}
     */
    copyDiv;

    /**
     * The div element containing `colorPicker` if `treeItem.colorable`. Otherwise, `null`.
     * @type {?Element}
     */
    colorDiv;

    /**
     * The color picker used to set the color of `treeItem` if `treeItem.colorable`.
     * Otherwise, `null`.
     * @type {?Picker}
     */
    colorPicker;

    /**
     * The button element used to set `treeItem` to a random color if `treeItem.colorable`.
     * Otherwise, `null`.
     * @type {?Element}
     */
    randomColorButton;

    /**
     * @param {!TreeItem} treeItem - The `TreeItem` to create the `Popup` for.
     */
    constructor(treeItem) {
        this.popup = htmlToElement("<div class='popup'></div>");

        const popupContent = htmlToElement("<div class='popup-content'></div>");
        this.popupContent = popupContent;
        this.popup.appendChild(popupContent);

        this.treeItem = treeItem;
        treeItem.li.append(this.popup);

        const text = treeItem.text;
        this.#text = text;  // set this.#text and not this.text so it doesn't call setter

        const closeButton = htmlToElement("<a class='close'>&times</a>");
        popupContent.appendChild(closeButton);
        closeButton.addEventListener("click", () => this.hide());

        if (treeItem.renamable) {
            const renameDiv = htmlToElement(`<div><h3>Rename ${text}</h3></div>`);
            this.renameDiv = renameDiv;
            const renameInput = htmlToElement(`<input type="text" value="${text}">`);
            this.renameInput = renameInput;
            renameDiv.append(renameInput);
            renameInput.addEventListener("keypress", (event) => {
                if (event.key === "Enter") {
                    const oldText = treeItem.text;
                    // any time something new is done, redos reset without
                    // changing its reference from globals.redoStorage
                    // redoStorage.length = 0;  // clear redos
                    treeItem.rename(renameInput.value);
                    this.text = renameInput.value;
                    undoStorage.push(["renamed", treeItem.id, oldText]);
                    this.hide();
                }
            });
            popupContent.append(renameDiv);
        }

        if (treeItem.moveTo) {
            popupContent.append(document.createElement("br"));
            this.moveDiv = htmlToElement(`<div><h3>Move ${text} to another group</h3></div>`);;
            this.updateMoveTo();
            popupContent.append(this.moveDiv);
        }

        if (treeItem.copyTo) {
            popupContent.append(document.createElement("br"));
            this.copyDiv = htmlToElement(`<div><h3>Copy ${text} to another group</h3></div>`);
            this.updateCopyTo();
            popupContent.append(this.copyDiv);
        }

        if (treeItem.colorable) {
            const colorDiv = htmlToElement(`<div><h3>Pick a new color for ${text}</h3></div>`);
            this.colorDiv = colorDiv;
            const colorPicker = new Picker({
                parent: colorDiv,
                popup: false,
                alpha: false
            });
            this.colorPicker = colorPicker;
            colorPicker.onDone = (color) => {
                treeItem.color = color.hex.substring(0, 7);
                this.hide();
            };

            const randomColorButton = htmlToElement("<button>Set to random color</button>");
            this.randomColorButton = randomColorButton;
            colorDiv.append(randomColorButton);
            randomColorButton.addEventListener("click", () => {
                const randomColor = getRandomColor();
                treeItem.color = randomColor;
                this.colorPicker.setColor(randomColor, true);
            });

            popupContent.append(colorDiv);
        }
    }

    /**
     * The text shown in the headers of this popup's divs.
     * Always equals `treeItem.text`.
     * @type {string}
     */
    get text() { return this.#text; }
    set text(newText) {
        this.#text = newText;
        if (this.renameDiv) {
            this.renameDiv.firstElementChild.innerHTML = `Rename ${newText}`;
        }
        if (this.moveDiv) {
            this.moveDiv.firstElementChild.innerHTML = `Move ${newText} to another group`;
        }
        if (this.copyDiv) {
            this.copyDiv.firstElementChild.innerHTML = `Copy ${newText} to another group`;
        }
        if (this.colorDiv) {
            this.colorDiv.firstElementChild.innerHTML = `Pick a new color for ${newText}`;
        }
    }

    /** Updates content and displays this popup. */
    show() {
        if (this.moveDiv) { this.updateMoveTo(); }
        if (this.copyDiv) { this.updateCopyTo(); }
        if (this.colorPicker) {
            this.colorPicker.setColor(this.treeItem.color || "#000000", true);
        }
        if (this.renameDiv || !this?.moveDiv?.hidden || !this?.copyDiv?.hidden || this.colorDiv) {
            this.popup.style.display = "block";
        }
    }

    /** Hides this popup. */
    hide() { this.popup.style.display = "none"; }

    /**
     * Updates the radio buttons in `moveDiv`.
     * This adds buttons for new `TreeItem`s that `treeItem` can be moved to and removes buttons
     * for `TreeItem`s that it can't be moved to anymore.
     */
    updateMoveTo() {
        const moveDiv = this.moveDiv;
        while (moveDiv.children[1]) {
            moveDiv.removeChild(moveDiv.lastChild);
        }
        const moveTo = this.treeItem.expandMoveTo();
        if (moveTo.length == 0) { moveDiv.hidden = true; }
        else {
            moveDiv.hidden = false;
            moveTo.forEach(dest => this.addMoveRadio(dest));
        }
    }

    /**
     * Updates the radio buttons in `copyDiv`.
     * This adds buttons for new `TreeItem`s that `treeItem` can be copied to and removes buttons
     * for `TreeItem`s that it can't be copied to anymore.
     */
    updateCopyTo() {
        const copyDiv = this.copyDiv;
        while (copyDiv.children[1]) {
            copyDiv.removeChild(copyDiv.lastChild);
        }
        const copyTo = this.treeItem.expandCopyTo();
        if (copyTo.length == 0) { copyDiv.hidden = true; }
        else {
            copyDiv.hidden = false;
            copyTo.forEach(dest => this.addCopyRadio(dest));
        }
    }

    /**
     * Adds a radio button used to move `treeItem`.
     * @param {string} destId - The id of the `TreeItem` to move `treeItem` to when the radio
     *      button is clicked.
     */
    addMoveRadio(destId) {
        const dest = TreeItem.byId[destId];

        const radioDiv = htmlToElement("<div><label>"
            + `<input type="radio" name="${this.treeItem.id}-radios" autocomplete="off"> ${destId}`
            + "</label><br></div>");
        const radioButton = radioDiv.firstElementChild.firstElementChild;

        this.moveDiv.append(radioDiv);

        radioButton.addEventListener("change", () => {
            undoStorage.push(["moved", this.treeItem.id, this.treeItem.parent.id]);
            // redoStorage.length = 0;  // clear redos
            this.treeItem.parent = dest;
            dest.sort("startTime");
            dest.open();
            radioButton.checked = false;
            this.hide();
        });
    }

    /**
     * Adds a radio button used to copy `treeItem`.
     * @param {string} destId - The id of the `TreeItem` to copy `treeItem` to when the radio
     *      button is clicked. 
     */
    addCopyRadio(destId) {
        const dest = TreeItem.byId[destId];

        const radioDiv = htmlToElement("<div><label>"
            + `<input type="radio" name="${this.treeItem.id}-radios" autocomplete="off"> ${destId}`
            + "</label><br></div>");
        const radioButton = radioDiv.firstElementChild.firstElementChild;

        this.copyDiv.append(radioDiv);

        radioButton.addEventListener("change", () => {
            let copied = this.treeItem.copy(dest);
            if (copied) {
                if (!Array.isArray(copied)) { copied = [copied]; }
                copied = copied.map(copy => copy.id);
                undoStorage.push(["copied", copied]);
                // redoStorage.length = 0;  // clear redos
                dest.sort("startTime");
            }
            dest.open();
            radioButton.checked = false;
            this.hide();
        });
    }
}

/**
 * A group of `Group`s.
 * @extends TreeItem
 */
var GroupOfGroups = class GroupOfGroups extends TreeItem {
    // Some groups are groups of groups instead of groups of segments, so the implementation
    // of some methods are slightly different which is why need separate `GroupOfGroups` class
    // (otherwise would need lots of if statements in `Group` to check what type of group it is

    /**
     * An object containing all `GroupOfGroups` by their id.
     * Key is id, value is corresponding `GroupOfGroups`:
     * {id: `GroupOfGroups`}
     * @type {!Object.<string, GroupOfGroups>}
     * @static
     */
    static byId = {};

    /**
     * HTML strings for the play, pause, loop, and remove icons for `GroupOfGroups` in the tree.
     * @type {!Object.<string, string>}
     * @static
     */
    static icons = groupIcons;

    /**
     * @param {string} id - The unique identifier to give the `GroupOfGroups`.
     * @param {?Object.<string, any>=} options - Options to customize the group.
     * @param {?GroupOfGroups=} options.parent - The `GroupOfGroups` that contains the group in its
     *      nested content.
     * @param {?Array.<Group|GroupOfGroups>=} options.children - An array of `Group`s and
     *      `GroupOfGroups`s to put in the group's nested content.
     * @param {string=} options.text - The text to show in the group's span (and therefore in the
     *      tree). If `null`, `id` is used.
     * @param {boolean} [options.removable=false] - Indicates if the group can be removed from
     *      the tree.
     * @throws {Error} If a `TreeItem` with `id` already exists.
     */
    constructor(id, { parent = null, children = null, text = null, removable = false } = {}) {
        super(id, { parent, children, text, removable });

        GroupOfGroups.byId[id] = this;
    }

    /** Sets the CSS styling of the group's elements. */
    style() {
        this.li.style.fontSize = "18px";
    }

    /**
     * Toggles this group on / off.
     * Specifically, toggles this group's elements on / off and shows / hides all of its
     * `Segment`s on the Peaks waveform.
     * @param {boolean=} force - If unspecified, this group is always toggled. Otherwise, this
     *      group is only toggled if its current state isn't equal to `force`.
     * @returns {boolean} A `boolean` indiciating if any toggling was done. In other words, when
     *      `force == null`, returns `true`. Otherwise, returns `force !== checked`.
     * @see toggleTree
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return false; }  // no toggling necessary
        const checked = force === null ? this.checked : force;
        this.children.forEach(function (child) { child.toggle(checked); });
        return true;
    }

    /**
     * Plays each visible `Segment` belonging to this group in chronological order.
     * @param {boolean} [loop=false] - If `true`, loops the segments (reaching the end of the
     *      segments will restart playing at the beginning).
     */
    play(loop = false) {
        const segments = sortByProp(this.getSegments({ visible: true }), "startTime");
        if (segments.length == 0) { return; }

        // See Segment.play() for reasoning behind event listener
        peaks.once("player.pause", () => {
            peaks.player.playSegments(segments, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = groupIcons.pause;

            // make function here so event listener can be removed
            const pause = function () { peaks.player.pause(); }
            button.addEventListener("click", pause, { once: true });
            // triggered by clicking pause button in tree, pause button on
            // media controls, or play on other tree item
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? groupIcons.loop : groupIcons.play;
                button.removeEventListener("click", pause);  // remove old event listener
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only emits pause event if playing
        // when paused, so have to play audio if not already
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }

    /**
     * Gets this group's `Segment`s.
     * This group's segments are the segments of all of its children.
     * @param {?Object.<string, boolean>=} options - Options specifying which `Segment`s to get.
     * @param {boolean} [options.hidden=false] - Indicates to return `Segment`s that are
     *      currently hidden on the Peaks waveform.
     * @param {boolean} [options.visible=false] - Indicates to return `Segment`s that are
     *      currently visible on the Peaks waveform.
     * @returns {!Array.<Segment>} An array containing the `Segment`s specified by `options`.
     */
    getSegments({ hidden = false, visible = false } = {}) {
        const segments = [];
        this.children.forEach(function (child) {
            // array.push(...) is faster than array.concat()
            segments.push(...child.getSegments({ hidden, visible }));
        })
        return segments;
    }
}

/**
 * A group of `Segment`s.
 * @extends TreeItem 
 */
var Group = class Group extends TreeItem {

    /**
     * An object containing all `Group`s by their id.
     * Key is id, value is corresponding `Group`:
     * {id: `Group`}
     * @type {!Object.<string, Group>}
     * @static
     */
    static byId = {};

    /**
     * HTML strings for the play, pause, loop, and remove icons for `Group`s in the tree.
     * @type {!Object.<string, string>}
     * @static
     */
    static icons = groupIcons;

    /**
     * Names of properties to get in `getProperties`.
     * @type {!Array.<string>}
     * @static
     */
    static properties = ["snr", "color", "colorable"];

    // TODO: move this method outside of this class (maybe to init.js?) since this is only ever
    //       meant to be called once and will break if any groups don't have snrs. Doens't really
    //       make sense to be here
    /**
     * Adds a circled number to the left of every `Group`s' text representing that `Group`'s rank.
     * These ranks are determined from the `Group`'s SNR and duration. The `Group` with rank 1 is
     * the predicted primary signal.
     * @static
     */
    static rankSnrs() {
        const groups = Object.values(Group.byId).filter(group => group.snr !== null);
        if (groups.length == 0) { return; }  // no groups have SNRs

        const snrs = {};
        const durations = {};
        groups.forEach(function (group) {
            snrs[group.id] = group.snr;
            durations[group.id] = group.duration;
        });

        // add the numbers in the circles next to the text of the speakers in the tree
        sortByProp(groups, "snr", true);  // decreasing order because want highest snr to be 1
        for (let i = 0; i < groups.length; i++) {
            // uses HTML symbol codes for the circled numbers
            // (can be found at https://www.htmlsymbols.xyz/search?q=circled)
            // numbers 1 - 20 use 9312 - 9331 (inclusive),
            // numbers 21 - 35 use 12881 - 12895 (inclusive)
            // should probably add case for numbers 36 - 50?
            // Extremely unlikely ever have that many speakers but still
            groups[i].text = `&#${(i <= 19 ? 9312 : 12861) + i} ${groups[i].text}`
        }

        // for the next lines (snrMean to durZScores), it would be faster to loop
        // through snrs and durations together, but it's a lot more readable this way,
        // and this code is only executed once so it shouldn't be too big of a problem
        const snrMean = arrayMean(Object.values(snrs));
        const durMean = arrayMean(Object.values(durations));

        // calculate standard deviations
        const standardDeviation = (num, mean) => (num - mean) ** 2;
        const snrStdDev = Math.sqrt(
            arrayMean(Object.values(snrs), standardDeviation, snrMean));
        const durStdDev = Math.sqrt(
            arrayMean(Object.values(durations), standardDeviation, durMean));

        // calculate z scores
        const zScore = (num, mean, stdDev) => (num - mean) / stdDev;
        const snrZScores = objectMap(snrs, zScore, snrMean, snrStdDev);
        const durZScores = objectMap(durations, zScore, durMean, durStdDev);

        const overallZScores = {};
        for (const key in snrZScores) {
            overallZScores[key] = snrZScores[key] + durZScores[key];
        }

        let maxSpeaker = groups[0].id;
        let maxZ = overallZScores[maxSpeaker];
        for (const key of Object.keys(snrZScores)) {
            if (maxZ < overallZScores[key]) {
                maxSpeaker = key;
                maxZ = overallZScores[key];
            }
        }
        // highlight text of speaker with highest z score
        Group.byId[maxSpeaker].span.style.color = "violet";
    }

    /**
     * The signal-to-noise ratio (SNR) of this `Group` if it has one. Otherwise, `null`.
     * @type {?number}
     */
    snr;

    /**
     * The color of this group's `Segment`s in the Peaks waveform.
     * If no color is given in the constructor, `null` until a `Segment` is added to this group.
     * @type {?Color}
     */
    #color;

    /**
     * A `boolean` indicating if this item can be recolored.
     * @type {boolean}
     */
    colorable;

    /**
     * An object containing the `Segment`s that are currently hidden in Peaks.
     * Key is id, value is corresponding `Segment`:
     * {id: `Segment`}
     * @type {!Object.<string, Segment>}
     */
    hidden = {};

    /**
     * An object containing the `Segment`s that are currently visible in Peaks.
     * Key is id, value is corresponding `Segment`:
     * {id: `Segment`}
     * @type {!Object<string, Segment>}
     */
    visible = {};

    // FIXME: in every doc comment, decide when to use things like
    //        `Group` / `GroupOfGroups` vs group and `Segment` vs segment
    /**
     * @param {string} id - The unique identifier to give the `Group`.
     * @param {?Object.<string, any>=} options - Options to customize the `Group`.
     * @param {?GroupOfGroups=} options.parent - The `GroupOfGroups` that contains the group in its
     *      nested content.
     * @param {?Array.<Segment>=} options.children - An array of `Segment`s to put in the group's
     *      nested content.
     * @param {number=} options.snr - The signal-to-noise ratio of the group.
     * @param {string=} options.text - The text to show in the group's span (and therefore in the
     *      tree). If `null`, `id` is used.
     * @param {boolean} [options.removable=false] - Indicates if the group can be removed from
     *      the tree.
     * @param {boolean} [options.renamable=false] - Indicates if the group can be renamed.
     * @param {Color=} options.color - The `Color` to give the group's segments. If `null`, the
     *      color of the first `Segment` added to the group will be used.
     * @param {boolean} [options.colorable=false] - Indicates if the group can be recolored.
     * @param {?Array.<string>=} [options.moveTo] - An array of the ids of `TreeItem`s that the
     *      group can be moved to. `null` if the group isn't moveable.
     * @param {?Array.<string>=} [options.copyTo] - An array of the ids of `TreeItem`s that the
     *      group can be copied to. `null` if the group isn't copyable.
     * @throws {Error} If a `TreeItem` with `id` already exists.
     */
    constructor(id, {
        parent = null,
        children = null,
        snr = null,
        text = null,
        removable = false,
        renamable = false,
        color = null,
        colorable = false,
        moveTo = null,
        copyTo = null
    } = {}) {

        // always have to call constructor for super class (TreeItem)
        super(id, { parent, children, text, removable, renamable, moveTo, copyTo });

        Group.byId[id] = this;
        this.snr = snr;
        if (children) { this.sort("startTime"); }

        if (color) { this.#color = color; }
        this.colorable = colorable;

        if (renamable || moveTo || copyTo || colorable) { this.popup = new Popup(this); }
    }

    /**
     * The color of this group's `Segment`s in the Peaks waveform.
     * If no color is given in the constructor, `null` until a `Segment` is added to this group.
     * @type {?Color}
     */
    get color() { return this.#color; }
    set color(newColor) {
        if (this.#color && !this.colorable) {
            throw new Error(`TreeItem ${this.id} is not colorable.`);
        }
        this.#color = newColor;
        this.children.forEach(segment => segment.update({ color: newColor }));
    }

    /** Updates the title (tooltip) of `span`. */
    updateSpanTitle() {
        if (this.snr) {
            this.span.title = `SNR: ${this.snr.toFixed(2)}\nDuration: ${this.duration.toFixed(2)}`;
        }
        else { super.updateSpanTitle(); }  // if group doesn't have snr, uses default span title
    }

    /** Sets the CSS styling of the group's elements. */
    style() {
        this.li.style.fontSize = "18px";
    }

    /** Removes this group and all of its segments from the tree and Peaks waveform. */
    remove() {
        // redoStorage.length = 0;  // clear redos
        for (var kid of this.children) {
            // true at end of undo signals that the "deleted segment"
            // was deleted as part of a "deleted group"
            undoStorage.push([
                "deleted segment",
                kid.segment,
                kid.getProperties(["id", "duration", "color", "labelText"]),
                true
            ]);
        }
        super.remove();
        // this way it only happens when a group has removed not all removes
        undoStorage.push(["deleted group", this.id, this.getProperties(["id", "duration"])]);
    }

    /**
     * Renames this group, replacing its id, text, and the labelText of each of its segments.
     * @param {string} newId - The new id to give this group.
     * @returns {boolean} A `boolean` indicating if renaming was successful. Renaming is successful
     *      if there's no `TreeItem` with `newId`.
     */
    rename(newId) {
        try { super.rename(newId); }
        catch (error) { return false; }  // unsuccessful because TreeItem with newId already exists
        this.getSegments({ hidden: true, visible: true })
            .forEach(segment => segment.update({ "labelText": `${newId}\n${segment.text}` }));
        return true;
    }

    /**
     * Toggles this group on / off.
     * Specifically, toggles this group's elements on / off and shows / hides all of its
     * `Segment`s on the Peaks waveform.
     * @param {boolean=} force - If unspecified, this group is always toggled. Otherwise, this
     *      group is only toggled if its current state isn't equal to `force`.
     * @return {boolean} A `boolean` indiciating if any toggling was done. In other words, when
     *      `force == null`, returns `true`. Otherwise, returns `force !== checked`.
     * @see toggleTree
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return false; }  // no toggling necessary
        const checked = force === null ? this.checked : force;
        this.children.forEach(function (child) { child.toggleTree(checked); });
        if (checked) {  // add the hidden segments to peaks
            peaks.segments.add(Object.values(this.hidden).map(hidden => hidden.segment));
            this.visible = Object.assign({}, this.visible, this.hidden);
            this.hidden = {};
            Object.values(this.visible).forEach(segment => segment.updateEditable());
        }
        else {  // remove the visible segments from peaks
            Object.values(this.visible).forEach(function (segment) {
                peaks.segments.removeById(segment.id);
            });
            this.hidden = Object.assign({}, this.hidden, this.visible);
            this.visible = {};
        }

        return true;
    }

    /**
     * Plays each visible `Segment` belonging to this group in chronological order.
     * @param {boolean} [loop=false] - If `true`, loops the segments (reaching the end of the
     *      segments will restart playing at the beginning).
     */
    play(loop = false) {
        if (this.visible.length == 0) { return; }  // nothing to play, so don't add event listener

        const segments = sortByProp(Object.values(this.visible), "startTime");
        // See Segment.play() for reasoning behind event listener
        peaks.once("player.pause", () => {
            peaks.player.playSegments(segments, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = groupIcons.pause;

            // make function here so event listener can be removed
            const pause = function () { peaks.player.pause(); }
            button.addEventListener("click", pause, { once: true });
            // triggered by clicking pause button in tree, pause button on
            // media controls, or play on other tree item
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? groupIcons.loop : groupIcons.play;
                button.removeEventListener("click", pause);  // remove old event listener
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only emits pause event if playing
        // when paused, so have to play audio if not already
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }

    /**
     * Copies all of the `Segment`s of this group to another.
     * @param {!Group} copyParent - `Group` to add the copied segments to.
     * @returns {!Array.<Segment>} The array of copied segments.
     */
    copy(copyParent) {
        const copiedSegments = [];
        for (const child of this.children) {
            const copiedChild = child.copy(copyParent);
            if (copiedChild) { copiedSegments.push(copiedChild); }
        }
        return copiedSegments;
    }

    /**
     * Converts `moveTo` to `TreeItem`s and expands the groups.
     * @see expandGroups
     */
    expandMoveTo() {
        const moveToAsTreeItems = TreeItem.idsToTreeItems(this.moveTo);
        const expanded = expandGroups(moveToAsTreeItems, [this.id]);
        return TreeItem.treeItemsToIds(expanded);
    }

    /**
     * Converts `copyTo` to `TreeItem`s and expands the groups.
     * @see expandGroups
     */
    expandCopyTo() {
        const copyToAsTreeItems = TreeItem.idsToTreeItems(this.copyTo);
        const expanded = expandGroups(copyToAsTreeItems, [this.id]);
        return TreeItem.treeItemsToIds(expanded);
    }

    /**
     * Gets this group's `Segment`s.
     * @param {?Object.<string, boolean>=} options - Options specifying which `Segment`s to get.
     * @param {boolean} [options.hidden=false] - Indicates to return `Segment`s that are
     *      currently hidden on the Peaks waveform.
     * @param {boolean} [options.visible=false] - Indicates to return `Segment`s that are
     *      currently visible on the Peaks waveform.
     * @returns {!Array.<Segment>} An array containing the `Segment`s specified by `options`.
     */
    getSegments({ hidden = false, visible = false } = {}) {
        const segments = [];
        if (hidden) { segments.push(...Object.values(this.hidden)); }
        if (visible) { segments.push(...Object.values(this.visible)); }
        return segments;
    }
}

/**
 * A `TreeItem` for a Peaks.js segment.
 * @extends TreeItem
 */
var Segment = class Segment extends TreeItem {

    /**
     * An object containing all `Segment`s by their id.
     * Key is id, value is corresponding `Segment`:
     * {id: `Segment`}
     * @type {!Object.<string, Segment>}
     * @static
     */
    static byId = {};

    /**
     * HTML strings for the play, pause, loop, and remove icons for `Segment`s in the tree.
     * @type {!Object.<string, string>}
     * @static
     */
    static icons = segmentIcons;

    /**
     * Names of properties to get in `getProperties`.
     * @type {!Array.<string>}
     * @static
     */
    static properties = ["startTime", "endTime", "editable", "color", "labelText", "treeText"];

    /**
     * The Peaks.js segment being represented in the tree by this `Segment`.
     * @type {!Peaks.Segment}
     */
    segment;

    /**
     * A `boolean` indicating if this segment is editable.
     * This is the true value of this segments' editablility and isn't changed.
     * It is used for determining if this segment has drag handles and for showing / hiding
     * said drag handles if it has them.
     * @type {boolean}
     */
    #editable;

    /**
     * A `boolean` indicating if this segment is currently editable.
     * If the segment isn't editable, this is always `false`. Otherwise, this is `true` if this
     * segment's drag handles are shown and `false` if they're hidden.
     * @type {boolean}
     */
    currentlyEditable;

    /**
     * @param {!Peaks.Segment} segment - The Peaks segment being represented in the tree by the
     *      `Segment`.
     * @param {?Object.<string, any>=} options - Options to customize the segment.
     * @param {?Group=} options.parent - The `Group` that contains the segment in its nested
     *      content.
     * @param {string=} options.text - The text to show in the segment's span (and therefore in the
     *      the tree).
     * @param {boolean} [options.removable=false] - Indicates if the segment can be removed from
     *      the tree.
     * @param {boolean} [options.renamable=false] - Indicates if the segment can be renamed.
     * @param {?Array.<string>=} options.moveTo - An array of the ids of `TreeItem`s that the
     *      segment can be moved to. `null` if the group isn't moveable.
     * @param {?Array.<string>=} options.copyTo - An array of the ids of `TreeItem`s that the
     *      segment can be copied to. `null` if the group isn't copyable.
     * @throws {Error} If a `TreeItem` with `segment.id` already exists.
     */
    constructor(segment, {
        parent = null,
        text = null,
        removable = false,
        renamable = false,
        moveTo = null,
        copyTo = null
    } = {}) {

        // catch options contained within segment
        text = text || segment.treeText;
        // segment.removable and segment.renamable are non-null if they are loaded from saved
        // segments in the database
        removable = segment.removable != null ? segment.removable : removable;
        renamable = segment.renamable != null ? segment.renamable : renamable;

        // don't render yet because some methods rely on this.segment but not defined yet
        // (can't use 'this' until after super() call, so can't define this.segment until after)
        super(segment.id, { text, removable, renamable, moveTo, copyTo, render: false });
        this.segment = segment;
        Segment.byId[segment.id] = this;

        this.render();
        this.updateDuration();
        this.parent = parent;

        this.#editable = this.segment.editable;
        this.currentlyEditable = this.segment.editable;

        // segment only needs a popup if it's renamable, movable, or copyable
        if (this.renamable || this.moveTo || this.copyTo) { this.popup = new Popup(this); }
    }

    /**
     * This segment's start time in seconds.
     * @type {number}
     */
    get startTime() { return this.segment.startTime; }
    set startTime(newStart) { this.segment.update({ startTime: newStart }); }

    /**
     * This segment's end time in seconds.
     * @type {number}
     */
    get endTime() { return this.segment.endTime; }
    set endTime(newEnd) { this.segment.update({ endTime: newEnd }); }

    /**
     * A `boolean` indicating if this segment can be edited. If it is editable, this segment will
     * have handles at its start and end that allow changing its start and end times.
     * @type {boolean}
     */
    get editable() { return this.#editable; }

    /**
     * This segment's color in the Peaks waveform.
     * @type {!Color}
     */
    get color() { return this.segment.color; }

    /**
     * The segment's text label.
     * It is displayed when the segment is hovered over by the mouse pointer.
     * @type {string}
     */
    get labelText() { return this.segment.labelText; }

    /**
     * The text shown in `span` (and therefore in the tree).
     * @type {string}
     */
    get treeText() { return this.text; }  // backwards compatibility (database expects 'treeText')

    /**
     * Updates properties of the Peaks segment.
     * @param {!Object.<string, any>} options - Options specifying the new values of the
     *      properties being updated.
     * @param {number=} options.startTime - The segment's start time in seconds.
     * @param {number=} options.endTime - The segment's end time in seconds.
     * @param {boolean=} options.editable - Indicates if the segment can be edited (moved around).
     * @param {?Color=} options.color - The segment's color in the Peaks waveform.
     * @param {string=} options.labelText - The segment's text label.
     */
    update(options) { this.segment.update(options); }

    /**
     * The `Group` that contains the segment in its nested content.
     * @type {!Group}
     */
    get parent() { return super.parent; }
    set parent(newParent) {
        const id = this.id;
        const segment = this.segment;
        const parent = this.parent;
        if (parent) {
            if (parent.hidden[id]) { delete parent.hidden[id]; }
            else { delete parent.visible[id]; }
        }

        if (newParent.color) { segment.update({ color: newParent.color }); }
        else { newParent.color = segment.color; }

        segment.update({ labelText: `${newParent.id}\n${this.text}` });
        if (this.checked) { newParent.visible[this.id] = this; }
        else { newParent.hidden[this.id] = this; }
        super.parent = newParent;  // call TreeItem's setter for parent
    }

    // FIXME: move undo back to remove() and get rid of this method
    render() {
        super.render();
        if (this.removeButton) {
            this.removeButton.addEventListener("click", () => {
                // false at end of undo signals that the "deleted segment"
                // was NOT deleted as part of a "deleted group"
                undoStorage.push([
                    "deleted segment",
                    this.segment,
                    this.getProperties(["id", "duration", "color", "labelText"]),
                    false
                ]);
                // redoStorage.length = 0;  // clear redos
            });
        }
    }

    /** Updates `duration` using this segment's start and end times. */
    updateDuration() {
        const newDuration = this.endTime - this.startTime;
        const durationChange = newDuration - this.duration;
        this.duration = newDuration;
        this.updateSpanTitle();
        if (this.parent) { this.parent.updateDuration(durationChange); }
    }

    /** Updates the title (tooltip) of `span`. */
    updateSpanTitle() {
        this.span.title = `Start time: ${this.startTime.toFixed(2)}\n`
            + `End time: ${this.endTime.toFixed(2)}\n`
            + `Duration: ${this.duration.toFixed(2)}`;
    }

    /** Sets the CSS styling of the segment's elements. */
    style() {
        this.li.style.fontSize = "12px";
        this.checkbox.style.transform = "scale(0.85)";
    }

    /** Removes this segment from the tree and Peaks waveform. */
    remove() {
        const id = this.id;
        const parent = this.parent;


        if (parent.hidden[id]) { delete parent.hidden[id]; }
        else { delete parent.visible[id]; }

        if (peaks.segments.getSegment(id) === this.segment) { peaks.segments.removeById(id); }

        super.remove();
    }

    // FIXME: make all rename methods throw error
    /**
     * Renames this segment, replacing its id, text, and labelText.
     * @param {string} newId - the new id to give this segment.
     */
    rename(newText) {
        super.text = newText;
        if (this.parent) { this.segment.update({ labelText: `${this.parent.id}\n${newText}` }); }
        else { this.segment.update({ "labelText": newText }); }
    }

    /**
     * Toggles this segment on / off.
     * Specifically, toggles this segment's elements on / off and shows / hides its Peaks segment
     * on the Peaks waveform.
     * @param {boolean=} force - If unspecified, this segment is always toggled. Otherwise, this
     *      segment is only toggled if its current state isn't equal to `force`.
     * @return {boolean} A `boolean` indiciating if any toggling was done. In other words, when
     *      `force == null`, returns `true`. Otherwise, returns `force !== checked`.
     * @see toggleTree
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return false; }  // no toggling necessary

        const id = this.id;
        const parent = this.parent;
        const checked = force === null ? this.checked : force;

        if (checked) {  // add segment to peaks
            peaks.segments.add(this.segment);
            delete parent.hidden[id];
            parent.visible[id] = this;
            this.updateEditable();
        }
        else {  // remove segment from peaks
            peaks.segments.removeById(id);
            delete parent.visible[id];
            parent.hidden[id] = this;
        }

        return true;
    }

    /**
     * Toggles this segment's drag handles.
     * This only has an effect if this segment is editable as only editable segments have drag
     * handles.
     * @param {boolean=} force - If unspecified, the drag handles are always toggled. Otherwise,
     *      the drag handles are only toggled if their current state isn't equal to `force`.
     * @return {?boolean} If this segment is editable, returns a `boolean` indiciating if any
     *      toggling was done. In other words, when `force == null`, returns `true` and returns
     *      `force !== checked` when `force != null`. If this segment isn't editable, returns
     *      `null`.
     */
    toggleDragHandles(force = null) {
        if (!this.#editable) { return null; }  // this segment isn't editable
        if (force === this.segment.editable) {
            return false;  // false indicates nothing changed (no toggling necessary)
        }

        const enabled = force === null ? !this.segment.editable : force;
        this.currentlyEditable = enabled;
        // only update if segment is visible. If not visible, it's updated when toggled on
        // because if update segment when hidden, it becomes visible
        if (this.checked) { this.segment.update({ editable: enabled }); }

        return true;
    }

    // TODO: rename this method (it doesn't feel right / fit with similar)
    /**
     * Updates this segment's editability.
     * Called when this segment is toggled. It is used to update the Peaks segment's
     * editability in order to show / hide the drag handles.
     */
    updateEditable() {
        if (this.currentlyEditable != this.segment.editable) {
            this.segment.update({ editable: this.currentlyEditable });
        }
    }

    /**
     * Plays this segment.
     * @param {boolean} [loop=false] - If `true`, loops this segment (reaching the end of the
     *      segment will restart playing at the beginning).
     */
    play(loop = false) {
        // Have to put in event listener because need to call
        // peaks.player.pause() to switch other pause buttons 
        // back to play buttons, but pausing without
        // the event listener instantly changes the new pause
        // button (from this function call) to change back to
        // a play button. Very janky but I couldn't find a
        // different way
        peaks.once("player.pause", () => {
            peaks.player.playSegment(this.segment, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = segmentIcons.pause;

            // make function here so event listener can be removed
            const pause = function () { peaks.player.pause(); }
            button.addEventListener("click", pause, { once: true });
            // triggered by clicking pause button in tree, pause button on
            // media controls, or play on other tree item
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? segmentIcons.loop : segmentIcons.play;
                button.removeEventListener("click", pause);  // remove old event listener
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only emits pause event if playing
        // when paused, so have to play audio if not already
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }

    /**
     * Copies this segment to another `Group`.
     * @param {!Group} copyParent - `Group` to add the copied segment to.
     * @returns {?Segment} The copied segment if `copyParent` didn't already have a copy of this
     *      segment. Otherwise, `null`.
     */
    copy(copyParent) {
        // only copy if the new parent doesn't already have a copy of the segment
        if (!copyParent.children.some(
            child => propertiesEqual(this.segment, child.segment, ["startTime", "endTime"]))) {

            const segment = this.segment;
            const newSegment = peaks.segments.add({
                startTime: segment.startTime,
                endTime: segment.endTime,
                editable: true
            });
            return new Segment(newSegment, {
                parent: copyParent,
                text: this.text,
                removable: true,
                renamable: true,
                moveTo: ["Labeled"]
            });
        }
        console.log("copy already exists");
        return null;
    }

    /**
     * Converts `moveTo` to `TreeItem`s and expands the groups.
     * @see expandGroups
     */
    expandMoveTo() {
        const moveToAsTreeItems = TreeItem.idsToTreeItems(this.moveTo);
        const expanded = expandGroups(moveToAsTreeItems, [this.parent.id]);
        return TreeItem.treeItemsToIds(expanded);
    }

    /**
     * Converts `copyTo` to `TreeItem`s and expands the groups.
     * @see expandGroups
     */
    expandCopyTo() {
        const copyToAsTreeItems = TreeItem.idsToTreeItems(this.copyTo);
        const expanded = expandGroups(copyToAsTreeItems, [this.parent.id]);
        return TreeItem.treeItemsToIds(expanded);
    }
}

export { TreeItem, Popup, GroupOfGroups, Group, Segment };
