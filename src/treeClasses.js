// I really hate to put all of these classes in one file, but there was an issue with webpack where
// TreeItem.byId would be an empty object when accessed from Popup even though it definitely wasn't
// empty (log statements showed this), so need to all be in one file so that webpack doesn't mess up
// with imports. 
// Note that before moving to this solution, I made sure there weren't any circular dependencies, but
// it didn't solve the issue.

// Another note: even though Segment and Group both use Popups, I didn't want to put Popup in TreeItem
// because I didn't want to hard-code `Groups`s being expanded into `Group`s. In other words, it's
// possible someone may want to be able to move something to a `Groups` (and therefore not expand the
// `Groups`s into `Group`s within Popup), so didn't want to hard-code it into TreeItem. Probably better
// way to do this while still including Popup functionality in TreeItem?

import globals from "./globals";
import { htmlToElement, sortByProp, toggleButton, arrayMean, objectMap, propertiesEqual } from "./util";
import { groupIcons, segmentIcons } from "./icon";

const peaks = globals.peaks;

// instead of const use var so the classes hoist and can reference each other before definition
/** Class representing an item in a tree */
var TreeItem = class TreeItem {
    // While I think actually using this class in the tree in addition to its subclasses would work,
    // TreeItem isn't intended to be used in the tree and is more of an abstract class

    /** 
     * An object containing all `TreeItem`s by their id. 
     * Key is id, value is corresponding `TreeItem`:  {id: `TreeItem`}
     * @type {Object.<string, TreeItem>}
     * @static
     */
    static byId = {};
    /**
     * Returns an array of `TreeItem`s with the given ids
     * @param {string[]} ids - Array of ids
     * @returns {TreeItem[]} The `TreeItem`s corresponding to the ids
     * @static
     */
    static idsToTreeItems(ids) { return ids.map(id => TreeItem.byId[id]); }
    /**
     * Returns an array of the ids of the given `TreeItem`s
     * @param {TreeItem[]} treeItems - Array of `TreeItem`s
     * @returns {string[]} The ids corresponding to the given `TreeItem`s
     * @static
     */
    static treeItemsToIds(treeItems) { return treeItems.map(treeItem => treeItem.id); }
    /** 
     * Checks if a TreeItem by the given id exists
     * @param {string} id - id to check existence of
     * @returns {boolean} True if a TreeItem with `id` exists, false otherwise
     * @static
     */
    static exists(id) { return id in TreeItem.byId; }
    /**
     * HTML strings for the play, pause, loop, and remove icons for `TreeItem`s in the tree
     * @type {Object.<string, string>}
     * @static
     */
    static icons = groupIcons;

    /**
     * The unique identifier of this `TreeItem`
     * @type {string}
     */
    id;
    /**
     * `TreeItem` this belongs to
     * @type {(TreeItem|null)}
     */
    #parent;
    /**
     * Array of `TreeItem`s contained in this `TreeItem`'s nested content
     * @type {TreeItem[]}
     */
    children = [];

    #text;
    /**
     * How long this `TreeItem`'s audio lasts, in seconds
     * @type {number}
     */
    duration = 0;
    /**
     * A `boolean` indicating if this can be removed from the tree
     * @type {boolean}
     */
    removable;
    /**
     * A boolean indicating if this can be renamed
     * @type {boolean}
     */
    renamable;

    /**
     * The li of this `TreeItem`
     * @type {Element}
     */
    li;
    /**
     * The input element of the checkbox used to toggle this `TreeItem`
     * @type {Element}
     */
    checkbox;
    /**
     * The span element containing the text shown in `li`
     * @type {Element}
     */
    span;
    /**
     * The a element of the play button
     * @type {Element}
     */
    playButton;
    /**
     * The a element of the loop button
     * @type {Element}
     */
    loopButton;
    /**
     * If this `TreeItem` is removable, the a element of the remove button. Otherwise, null
     * @type {(Element|null)}
     */
    removeButton;
    /**
     * The ul element containing the nested content (the children) of this `TreeItem`
     * @type {Element}
     */
    nested;
    /** */
    popup;

    /**
     * @param {string} id - The unique identifier to give the `TreeItem`
     * @param {Object} options - An object containing options
     * @param {TreeItem=} options.parent - The `TreeItem` this `TreeItem` belongs to
     * @param {TreeItem[]=} options.children - An array of `TreeItem`s to put in this' nested content
     * @param {string=} options.text - The text to display in the tree. If null, uses `id` instead
     * @param {boolean} [options.removable=false] - Boolean indicating if this can be removed from the tree
     * @param {boolean} [options.renamable=false] - Boolean indicating if this can renamed
     * @param {boolean} [options.render=true] - If true, calls render() in constructor. Otherwise, render() is not called
     * @throws Throws an error if a `TreeItem` with `id` already exists
     */
    constructor(id, { parent = null, children = null, text = null, removable = false, renamable = false, render = true } = {}) {
        if (TreeItem.exists(id)) {
            throw new Error(`A TreeItem with the id ${id} already exists`);
        }

        TreeItem.byId[id] = this;

        this.id = id;

        this.#text = text || id;
        this.removable = removable;
        this.renamable = renamable;

        if (render) { this.render(); }
        if (parent) { this.parent = parent; }

        if (children) { children.forEach(function (child) { child.parent = this; }); }
    }

    /** The `TreeItem` this belongs to */
    get parent() { return this.#parent; }
    set parent(newParent) {
        if (this.#parent) {
            delete this.#parent.children[this.id];
        }
        this.#parent = newParent;
        newParent.children.push(this);
        newParent.nested.append(this.li);
        newParent.updateDuration(this.duration);
    }

    /** The text displayed in the tree */
    get text() { return this.#text; }
    set text(newText) {  // setter for text so that `this.text = newText` actually updates text in tree
        this.#text = newText;
        this.span.innerHTML = newText;
    }

    /** Boolean indicating if this `TreeItem`'s checkbox is checked. Equivalent to `this.checkbox.checked` */
    get checked() { return this.checkbox.checked; }
    set checked(bool) { this.checkbox.checked = bool; }

    /** 
     * null if this `TreeItem` doesn't have a parent. Otherwise, an array containing this' parent, this' parent's parent, etc. Top-most parents are first in the array, with this' parent being last. For example: [great-great-grandparent, great-grandparent, grandparent, parent]
     * @type {(TreeItem[]|null)}
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
     * Generates the HTML for the `TreeItem`
     */
    render() {
        const id = this.id;

        if (this.li) { this.li.remove(); }

        // since subclasses use this method, use this.constructor.icons to use the icons of whatever class is
        // being initialized (i.e. Group, TreeItem, Segment, etc.)
        const li = htmlToElement(`<li><input type="checkbox" autocomplete="off" checked><span>${this.#text}</span> <a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.play}   </a><a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.loop}   </a><ul class="nested active"></ul></li>`);
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
            const remove = htmlToElement(`<a href="javascript:;" ">${this.constructor.icons.remove}</a>`);
            this.loopButton.after(remove);
            remove.addEventListener("click", () => { this.remove(); });
            this.removeButton = remove;
        }

        // this is here for subclasses to define a style method if they want to apply specific CSS styles
        this.style?.();
    }

    /**
     * Renames the `TreeItem`, replacing its id and text in the tree
     * @param {string} newId - The new id
     * @returns {boolean} Boolean indicating if renaming was successful
     * @throws Throws an error if this `TreeItem` cannot be renamed
     * @throws Throws an error if a `TreeItem` with `newId` already exists
     */
    rename(newId) {
        if (!this.renamable) {
            throw new Error(`TreeItem ${this.id} is not renamable.`);
        }
        if (TreeItem.exists(newId)) {
            throw new Error(`A TreeItem with the id ${newId} already exists`);
        }
        delete TreeItem.byId[this.id];
        delete this.constructor.byId[this.id];  // removes this from subclasses byId, i.e. Group.byId
        TreeItem.byId[newId] = this;
        this.constructor.byId[newId] = this;  // adds this to subclasses byId, i.e. Group.byId
        this.id = newId;
        this.text = newId;
        return true;
    }

    /**
     * Sorts this `TreeItem`'s children in the tree
     * @param {string} by - The name of the property to sort by
     */
    sort(by) {
        const nested = this.nested;
        const children = sortByProp(this.children, by);
        children.forEach(function (segment) { nested.append(segment.li); });
    }

    /** Removes this `TreeItem` from the tree */
    remove() {
        if (!this.removable) {
            throw new Error(`TreeItem ${this.id} is not removable.`);
        }
        this.li.remove();
        delete TreeItem.byId[this.id];
        delete this.constructor.byId[this.id];  // removes this from subclasses byId, i.e. Group.byId
        this.children.forEach(function (child) { child.remove(); });
        if (this.#parent) { this.#parent.children = this.#parent.children.filter(child => child.id != this.id); }
    }

    /**
     * Toggles the checkbox in the tree, toggles the buttons, and hides/unhides the item's nested content.
     * @param {boolean=} force - If given, forces the item to toggle on/off. If true, force checks the checkbox, turns on the buttons, and unhides the nested content. If false, force unchecks the checkbox, turns off the buttons, and hides the nested content. If force equals this.checked, no toggling is done.
     * @returns {boolean} Always returns true if `force` is null. Otherwise, returns false if `force` equals this.checked, true otherwise. In other words, returns true if any toggling was done, false otherwise.
     */
    toggleTree(force = null) {
        if (force === this.checked) {
            return false;  // false indicates nothing changed (no toggling necessary)
        }

        const checked = force === null ? this.checked : force;
        this.checked = checked;

        this.nested.classList.toggle("active", checked);

        toggleButton(this.playButton, checked);
        toggleButton(this.loopButton, checked);
        if (this.removeButton) { toggleButton(this.removeButton, checked); }

        return true;  // true indicates things changed
    }

    /** Same as toggleTree() */
    toggle(force = null) { return this.toggleTree(force); }

    /** Shows this `TreeItem`'s nested content and shows nested content of each parent in the path of the `TreeItem` */
    open() {
        this.nested.classList.add("active");
        this.checked = true;
        if (this.#parent) { this.#parent.open(); }
    }

    /**
     * Updates the duration
     * @param {number} durationChange - The amount to change the duration by. If negative, decreases the duration. Increases duration otherwise.
     */
    updateDuration(durationChange) {
        this.duration = this.duration + durationChange;
        this.updateSpanTitle();

        if (this.#parent) { this.#parent.updateDuration(durationChange); }
    }

    /** Updates the title of the span */
    updateSpanTitle() {
        this.span.title = `Duration: ${this.duration.toFixed(2)}`;
    }
}

var Popup = class Popup {

    /**
     * 
     * @type {TreeItem}
     */
    treeItem;
    #text;
    /**
     * 
     * @type {Element}
     */
    popup;
    /**
     * 
     * @type {Element}
     */
    popupContent;
    /** */
    renameDiv;
    /**
     * 
     * @type {(Element|null)}
     */
    renameInput;
    /** */
    moveTo;
    /** */
    moveDiv;
    /** */
    moveRadios;
    /** */
    copyTo;
    /** */
    copyDiv;
    /** */
    copyRadios;

    /**
     * 
     * @param {TreeItem} treeItem - 
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

        popupContent.appendChild(htmlToElement("<h1>Placeholder instructions</h1>"));
        const closeButton = htmlToElement("<a class='close'>&times</a>");
        popupContent.appendChild(closeButton);
        closeButton.addEventListener("click", () => this.hide());

        if (treeItem.renamable) {
            const renameDiv = htmlToElement(`<div><h3>Rename ${text}</h3></div>`);
            this.renameDiv = renameDiv;
            const renameInput = htmlToElement(`<input type="text" value="${text}">`);
            this.renameInput = renameInput;
            renameDiv.appendChild(renameInput);
            renameInput.addEventListener("keypress", (event) => {
                if (event.key === "Enter") {
                    treeItem.rename(renameInput.value);
                    this.hide();
                }
            });
            popupContent.append(renameDiv);
        }

        if (treeItem.moveTo) {
            popupContent.append(document.createElement("br"));
            const moveDiv = htmlToElement(`<div><h3>Move ${text} to another group</h3></div>`);
            this.moveDiv = moveDiv;
            this.moveTo = [];
            this.moveRadios = {};
            this.updateMoveTo();
            popupContent.append(moveDiv);
        }

        if (treeItem.copyTo) {
            popupContent.append(document.createElement("br"));
            const copyDiv = htmlToElement(`<div><h4>Copy ${text} to another group</h4></div>`);
            this.copyDiv = copyDiv;
            this.copyTo = [];
            this.copyRadios = {};
            this.updateCopyTo();
            popupContent.append(copyDiv);
        }
    }

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
    }

    show() {
        if (this.moveTo) { this.updateMoveTo(); }
        if (this.copyTo) { this.updateCopyTo(); }
        this.popup.style.display = "block";
    }

    hide() { this.popup.style.display = "none"; }

    updateMoveTo() {
        const moveTo = this.moveTo;
        const newMoveTo = this.treeItem.expandMoveTo();
        newMoveTo.filter(dest => !moveTo.includes(dest)).forEach(dest => this.addMoveRadio(dest));
        moveTo.filter(dest => !newMoveTo.includes(dest)).forEach(dest => this.removeMoveRadio(dest));
        if (this.moveTo.length == 0) { this.moveDiv.hidden = true; }
        else { this.moveDiv.hidden = false; }
    }
    updateCopyTo() {
        const copyTo = this.copyTo;
        const newCopyTo = this.treeItem.expandCopyTo();
        newCopyTo.filter(dest => !copyTo.includes(dest)).forEach(dest => this.addCopyRadio(dest));
        copyTo.filter(dest => !newCopyTo.includes(dest)).forEach(dest => this.removeCopyRadio(dest));
        if (this.copyTo.length == 0) { this.copyDiv.hidden = true; }
        else { this.copyDiv.hidden = false; }
    }

    addMoveRadio(destId) {
        const dest = TreeItem.byId[destId];

        const radioDiv = htmlToElement(`<div><label><input type="radio" name="${this.treeItem.id}-radios" autocomplete="off"> ${destId}</label><br></div>`);
        const radioButton = radioDiv.firstElementChild;

        this.moveDiv.append(radioDiv);

        radioButton.addEventListener("change", () => {
            this.treeItem.parent = dest;
            dest.sort("startTime");
            dest.open();
            radioButton.checked = false;
            this.hide();
        });

        this.moveTo.push(destId);
        this.moveRadios[destId] = radioDiv;
    }
    addCopyRadio(destId) {
        const dest = TreeItem.byId[destId];

        const radioDiv = htmlToElement(`<div><label><input type="radio" name="${this.treeItem.id}-radios" autocomplete="off"> ${destId}</label><br></div>`);
        const radioButton = radioDiv.firstElementChild;

        this.copyDiv.append(radioDiv);

        radioButton.addEventListener("change", () => {
            this.treeItem.copy(dest);
            dest.sort("startTime");
            dest.open();
            radioButton.checked = false;
            this.hide();
        });

        this.copyTo.push(destId);
        this.copyRadios[destId] = radioDiv;
    }
    removeMoveRadio(destId) {
        this.moveRadios[destId].remove();
        delete this.moveRadios[destId];
        this.moveTo = this.moveTo.filter(moveId => moveId != destId);
    }
    removeCopyRadio(destId) {
        this.copyRadios[destId].remove();
        delete this.copyRadios[destId];
        this.copyTo = this.copyTo.filter(copyId => copyId != destId);
    }
}

/**
 * Class representing a group of `Group`s
 * @extends TreeItem
 */
var Groups = class Groups extends TreeItem {
    // Some groups are groups of groups instead of groups of segments, so the implementation
    // of some of the methods are slightly different which is why need separate `Groups` class
    // (otherwise would need lots of if statements in `Group` to check what type of group it is

    /**
     * An object containing all `Groups`' by their id.
     * Key is id, value is corresponding `Groups`:  {id: `Groups`}
     * @type {Object.<string, Groups>}
     * @static
     */
    static byId = {};
    /**
     * HTML strings for the play, pause, loop, and remove icons for `Groups` in the tree
     * @type {Object.<string, string>}
     * @static
     */
    static icons = groupIcons;

    /**
     * @param {string} id - The unique identifier to give this `Groups`
     * @param {Object} options - An object containing options
     * @param {Groups=} options.parent - The `Groups` object this `Groups` belongs to
     * @param {(Group|Groups)[]=} options.children - An array of `Group`s to put in this `Groups`
     * @param {string=} options.text - The text to display in the tree. If null, uses `id` instead
     * @param {boolean} [options.removable=false] - Boolean indicating if this can be removed from the tree
     * @throws Throws an error if a `TreeItem` with `id` already exists
     */
    constructor(id, { parent = null, children = null, text = null, removable = false } = {}) {
        super(id, { parent, children, text, removable });

        Groups.byId[id] = this;
    }

    /** Initialize the CSS styling of the `Groups` */
    style() {
        this.li.style.fontSize = "18px";
    }

    /**
     * Gets this `Groups`' `Segment`s
     * @param {Object} options - An object containing options
     * @param {boolean} [options.hidden=false] - Whether to include the `Segment`s currently hidden
     * @param {boolean} [options.visible=false] - Whether to include the `segment`s currently visible
     * @returns {Peaks.Segment[]} An array containing the `Segments` specified by options
     */
    getSegments({ hidden = false, visible = false } = {}) {
        const segments = [];
        this.children.forEach(function (child) {
            segments.push(...child.getSegments({ hidden, visible }));  // array.push(...) is faster than array.concat()
        })
        return segments;
    }

    /**
     * Toggles the item in the tree and hides/unhides all of this `Groups`' segments from the Peaks waveform
     * @param {boolean=} force - If given, forces the item to toggle on/off. If true, force checks the checkbox, turns on the buttons, and unhides the segments in Peaks. If false, force unchecks the checkbox, turns off the buttons, and hides the segments in Peaks. If force equals this.checked, no toggling is done.
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return; }  // force == this.checked so no toggling necessary
        const checked = force === null ? this.checked : force;
        this.children.forEach(function (child) { child.toggle(checked); });
    }

    /**
     * Plays each `Segment` belonging to this `Groups` in chronological order
     * @param {boolean} [loop=false] - If true, loops the `Groups`
     */
    play(loop = false) {
        const segments = sortByProp(this.getSegments({ visible: true }), "startTime");
        if (segments.length == 0) { return; }

        // See Segment.play() for reasoning behind event listener
        peaks.once("player.pause", () => {
            peaks.player.playSegments(segments, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = groupIcons.pause;

            const pause = function () { peaks.player.pause(); }  // make function here so event listener can be removed
            button.addEventListener("click", pause, { once: true });
            // triggered by clicking pause button in tree, pause button on media controls, or play on other tree item
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? groupIcons.loop : groupIcons.play;
                button.removeEventListener("click", pause);  // event listener might still be on button so remove
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only emits pause event if playing when paused, so have to play audio if not already
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }
}

/**
 * Class representing a group of `Segment`s
 * @extends TreeItem 
 */
var Group = class Group extends TreeItem {

    /**
     * An object containing all `Group`s by their id.
     * Key is id, value is corresponding `Group`:  {id: `Group`}
     * @type {Object.<string, Group>}
     * @static
     */
    static byId = {};
    /**
     * HTML strings for the play, pause, loop, and remove icons for `Group`s in the tree
     * @type {Object.<string, string>}
     * @static
     */
    static icons = groupIcons;
    /**
     * Adds numbers next to `Group`s' text in the tree corresponding to their snr rank, with highest snr being highest rank
     * @static
     */
    static rankSnrs() {
        const groups = Object.values(Group.byId).filter(group => group.snr !== null);

        const snrs = {};
        const durations = {};
        groups.forEach(function (group) {
            snrs[group.id] = group.snr;
            durations[group.id] = group.duration;
        });

        // add the numbers in the circles next to the text of the speakers in the tree
        sortByProp(groups, "snr", true);  // sort snrs decreasing order because want highest snr to be 1
        for (let i = 0; i < groups.length; i++) {
            // uses HTML symbol codes for the circled numbers (can be found at https://www.htmlsymbols.xyz/search?q=circled)
            // numbers 1 - 20 use 9312 - 9331 (inclusive), numbers 21 - 35 use 12881 - 12895 (inclusive)
            // should probably add case for numbers 36 - 50? Extremely unlikely ever have that many speakers but still
            groups[i].text = `&#${(i <= 19 ? 9312 : 12861) + i} ${groups[i].text}`
        }

        // for the next lines (snrMean to durZScores), it would be faster to loop through snrs and durations together, but
        // it's a lot more readable this way, and this code is only executed once so it shouldn't be too big of a problem
        const snrMean = arrayMean(Object.values(snrs));
        const durMean = arrayMean(Object.values(durations));

        const standardDeviation = (num, mean) => (num - mean) ** 2;  // function to calculate standard deviation
        const snrStdDev = Math.sqrt(arrayMean(Object.values(snrs), standardDeviation, snrMean));
        const durStdDev = Math.sqrt(arrayMean(Object.values(durations), standardDeviation, durMean));

        const zScore = (num, mean, stdDev) => (num - mean) / stdDev;  // function to calculate z score
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
        Group.byId[maxSpeaker].span.style.color = "violet";  // highlight text of speaker with highest z score
    }
    /**
     * Expands an array consisting of `Group`s and `Groups` by replacing `Groups` with their `Group` children
     * @param {(Group|Groups)[]} groups - Array of `Group`s and `Groups`s
     * @param {Group[]=} exclude - Array of `Group`s to exclude from expanded array
     * @returns {Group[]} The expanded array
     * @static
     */
    static #expand(groups, exclude = []) {
        const expanded = [];
        for (const group of groups) {
            if (group instanceof Group) {
                if (!exclude.includes(group.id)) { expanded.push(group); }
            }
            else { expanded.push(...Group.#expand(group.children, exclude)); }  // array.push(...) is faster than array.concat()
        }
        return expanded;
    }

    /**
     * A hex string of the form "#RRGGBB" representing the color of this `Group`'s `Segment`s in the Peaks viewer
     * @type {string}
     */
    color;
    /** */
    popup;
    /**
     * The signal-to-noise ratio of the `Group`
     * @type {(number|null)}
     */
    snr;
    /**
     * An object containing the `Segment`s that are currently hidden in Peaks. Key is id, value is corresponding `Segment`:  {id: `Segment`}
     * @type {Object}
     */
    hidden = {};
    /**
     * An object containing the `Segment`s that are currently visible in Peaks. Key is id, value is corresponding `Segment`:  {id: `Segment`}
     * @type {Object}
     */
    visible = {};
    /**
     * Array of ids of `Group`s and `Groups`s that this segment can be moved to
     * @type {string[]}
     */
    moveTo;
    /**
     * Array of ids of `Group`s and `Groups`s that this segment can be copied to
     * @type {string[]}
     */
    copyTo;

    /**
     * @param {string} id - The unique identifier to give this `Group`
     * @param {Object} options - An object containing options
     * @param {Groups=} options.parent - The `Groups` object this `Group` belongs to
     * @param {Segment[]=} options.children - An array of `Segment`s to put in this `Group`
     * @param {number=} options.snr - The signal-to-noise ratio
     * @param {string=} options.text - The text to display in the tree. If null, uses `id` instead
     * @param {boolean} [options.removable=false] - Boolean indicating if this can be removed from the tree
     * @param {boolean} [options.removable=false] - Boolean indicating if this can be renamed
     * @param {string=} options.color - 
     * @param {string[]=} options.moveTo - 
     * @param {string[]=} options.copyTo - 
     * @throws Throws an error if a `TreeItem` with `id` already exists
     */
    constructor(id, { parent = null, children = null, snr = null, text = null, removable = false, renamable = false, color = null, moveTo = [], copyTo = [] } = {}) {
        super(id, { parent, children, text, removable, renamable });  // always have to call constructor for super class (TreeItem)

        Group.byId[id] = this;
        this.snr = snr;
        if (children) { this.sort("startTime"); }

        if (color) { this.color = color; }

        this.moveTo = moveTo;
        this.copyTo = copyTo;

        if (this.renamable || this.moveTo || this.copyTo) { this.popup = new Popup(this); }
    }

    /**
     * Copies all of the `Segment`s of this `Group` to another
     * @param {Group} copyParent - `Group` to add the copied `Segment`s to
     * @returns {Segment[]} The copied `Segment`s
     */
    copy(copyParent) {
        const copiedSegments = [];
        for (const child of this.children) {
            const copiedChild = child.copy(copyParent);
            if (copiedChild) { copiedSegments.push(copiedChild); }
        }
        return copiedSegments;
    }

    /** */
    expandMoveTo() {
        const moveToAsTreeItems = TreeItem.idsToTreeItems(this.moveTo);
        const expanded = Group.#expand(moveToAsTreeItems, [this.id]);
        return TreeItem.treeItemsToIds(expanded);
    }
    /** */
    expandCopyTo() {
        const copyToAsTreeItems = TreeItem.idsToTreeItems(this.copyTo);
        const expanded = Group.#expand(copyToAsTreeItems, [this.id]);
        return TreeItem.treeItemsToIds(expanded);
    }

    /** Initialize the CSS styling of the `Group` */
    style() {
        this.li.style.fontSize = "18px";
    }

    /**
     * Renames the `Group`, replacing its id and text in the tree as well as its segments' labelText
     * @param {string} newId - The new id
     * @returns {boolean} Boolean indicating if renaming was successful
     */
    rename(newId) {
        try { super.rename(newId); }
        catch (error) { return false; }  // renaming unsuccessful because TreeItem with newId already exists
        this.getSegments({ hidden: true, visible: true }).forEach(segment => segment.update({ "labelText": newId }));
        return true;
    }

    /**
     * Toggles the item in the tree and hides/unhides all of this `Group`'s segments from the Peaks waveform
     * @param {boolean=} force - If given, forces the item to toggle on/off. If true, force checks the checkbox, turns on the buttons, and unhides the segments in Peaks. If false, force unchecks the checkbox, turns off the buttons, and hides the segments in Peaks. If force equals this.checked, no toggling is done.
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return; }  // force == this.checked so no toggling necessary
        const checked = force === null ? this.checked : force;
        this.children.forEach(function (child) { child.toggleTree(checked); });
        if (checked) {  // add the hidden segments to peaks
            peaks.segments.add(Object.values(this.hidden).map(hidden => hidden.segment));
            this.visible = Object.assign({}, this.visible, this.hidden);
            this.hidden = {};
        }
        else {  // remove the visible segments from peaks
            Object.values(this.visible).forEach(function (segment) {
                peaks.segments.removeById(segment.id);
            });
            this.hidden = Object.assign({}, this.hidden, this.visible);
            this.visible = {};
        }
    }

    /**
     * Plays each visible `Segment` belonging to the `Group` in chronological order
     * @param {boolean} [loop=false] - If true, loops the `Group`
     */
    play(loop = false) {
        if (this.visible.length == 0) { return; }  // nothing to play, so don't add event listener

        const segments = sortByProp(Object.values(this.visible), "startTime");
        // See Segment.play() for reasoning behind event listener
        peaks.once("player.pause", () => {
            peaks.player.playSegments(segments, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = groupIcons.pause;

            const pause = function () { peaks.player.pause(); }  // make function here so event listener can be removed
            button.addEventListener("click", pause, { once: true });
            // triggered by clicking pause button in tree, pause button on media controls, or play on other tree item
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? groupIcons.loop : groupIcons.play;
                button.removeEventListener("click", pause);  // event listener might still be on button so remove
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only emits pause event if playing when paused, so have to play audio if not already
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }

    /** Updates the title of the span */
    updateSpanTitle() {
        if (this.snr) {
            this.span.title = `SNR: ${this.snr.toFixed(2)}\nDuration: ${this.duration.toFixed(2)}`;
        }
        else { super.updateSpanTitle(); }  // if group doesn't have snr, it just uses default duration span title
    }

    /**
     * Gets this `Group`'s `Segment`s
     * @param {Object} options - An object containing options
     * @param {boolean} [options.hidden=false] - Whether to include the `Segment`s currently hidden
     * @param {boolean} [options.visible=false] - Whether to include the `Segment`s currently visible
     * @returns {Segment[]} An array containing the `Segment`s specified by options
     */
    getSegments({ hidden = false, visible = false } = {}) {
        const segments = [];
        if (hidden) { segments.push(...Object.values(this.hidden)); }  // array.push(...) is faster than array.concat()
        if (visible) { segments.push(...Object.values(this.visible)); }
        return segments;
    }
}

/**
 * Class representing a Peaks.js segment and its item in a tree
 * @extends TreeItem
 */
var Segment = class Segment extends TreeItem {

    /**
     * An object containing all `Segment`s by their id.
     * Key is id, value is corresponding `Segment`:  {id: `Segment`}
     * @type {Object.<string, Segment>}
     * @static
     */
    static byId = {};
    /**
     * HTML strings for the play, pause, loop, and remove icons for `Segment`s in the tree
     * @type {Object.<string, string>}
     * @static
     */
    static icons = segmentIcons;
    static #highestId;
    /** 
     * The highest number id of all Segments 
     * @type {number}
     * @static
    */
    static get highestId() {
        if (Segment.#highestId) { return Segment.#highestId; }  // only need to calculate highestId once
        const ids = Object.keys(Segment.byId);
        // since ids are of the form 'peaks.segment.#', parse the # from all of the ids
        const idNums = ids.map(id => parseInt(id.split(".").at(-1)));
        Segment.#highestId = Math.max(...idNums);  // Math.max takes numbers (not an array) so unpack array using ...
        return Segment.#highestId;
    }
    /**
     * A list of segment properties. Used by toSimple() in order to copy the properties to an object
     * @type {string[]}
     * @static
     */
    static #props = ["startTime", "endTime", "editable", "color", "labelText", "id", "path", "treeText", "removable"];
    /**
     * Expands an array consisting of `Group`s and `Groups` by replacing `Groups` with their `Group` children
     * @param {(Group|Groups)[]} groups - Array of `Group`s and `Groups`s
     * @param {Group[]=} exclude - Array of `Group`s to exclude from expanded array
     * @returns {Group[]} The expanded array
     * @static
     */
    static #expand(groups, exclude = []) {
        const expanded = [];
        for (const group of groups) {
            if (group instanceof Group) {
                if (!exclude.includes(group.id)) { expanded.push(group); }
            }
            else { expanded.push(...Segment.#expand(group.children, exclude)); }  // array.push(...) is faster than array.concat()
        }
        return expanded;
    }

    /**
     * A Peaks.js segment
     * @type {Peaks.Segment}
     */
    segment;
    /**
     * Array of ids of `Group`s and `Groups`s that this segment can be moved to
     * @type {string[]}
     */
    moveTo;
    /**
     * Array of ids of `Group`s and `Groups`s that this segment can be copied to
     * @type {string[]}
     */
    copyTo;

    /**
     * @param {Peaks.Segment} segment - An instance of a `Peaks.Segment`
     * @param {Object} options - An object containing options
     * @param {Group=} options.parent - The `Group` this `Segment` belongs to
     * @param {string=} options.text - The text displayed in the tree for this item
     * @param {boolean} [options.removable=false] - Boolean indicating if this can be removed from the tree
     * @param {boolean} [options.renamable=false] - Boolean indicating if this can be renamed
     * @param {string[]=} options.moveTo - 
     * @param {string[]=} options.copyTo - 
     * @throws Throws an error if a `TreeItem` with `id` already exists
     */
    constructor(segment, { parent = null, text = null, removable = false, renamable = false, moveTo = null, copyTo = null } = {}) {
        // catch options contained within segment
        text = text || segment.treeText;
        removable = segment.removable != null ? segment.removable : removable;
        renamable = segment.renamable != null ? segment.renamable : renamable;

        // don't render yet because some methods rely on this.segment but not defined yet
        // (can't use 'this' until after super() call, so can't define this.segment until after)
        super(segment.id, { text, removable, renamable, render: false });
        this.segment = segment;
        Segment.byId[segment.id] = this;

        this.render();
        this.updateDuration();
        this.parent = parent;

        this.moveTo = moveTo;
        this.copyTo = copyTo;

        // segment only needs a popup if it's renamable, movable, or copyable
        if (this.renamable || this.moveTo || this.copyTo) { this.popup = new Popup(this); }
    }

    /**
     * The segment's start time in seconds
     * @type {number}
     */
    get startTime() { return this.segment.startTime; }
    /**
     * The segment's end time in seconds
     * @type {number}
     */
    get endTime() { return this.segment.endTime; }
    /**
     * Whether the segment is user-editable
     * @type {boolean}
     */
    get editable() { return this.segment.editable; }
    /**
     * The segment's color. Hex string of the form '#RRGGBB'
     * @type {string}
     */
    get color() { return this.segment.color; }
    /**
     * A text label which is displayed the user hovers the mouse pointer over the segment
     * @type {string}
     */
    get labelText() { return this.segment.labelText; }
    /**
     * Updates properties of the Peaks segment.
     * @param {Object} options - An object containing options
     * @param {number=} options.startTime - The segment's start time in seconds
     * @param {number=} options.endTime - The segment's end time in seconds
     * @param {boolean=} options.editable - Whether the segment is user-editable
     * @param {string=} options.color - The segment's color
     * @param {string=} options.labelText - A text label which is displayed when the user hovers the mouse pointer over the segment
     */
    update(options) { this.segment.update(options); }

    /** The `Group` this `Segment` belongs to */
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

    /**
     * @param {string[]} [exclude=[]] - A list of properties to exclude from the returned object
     * @returns An object containing this `Segment`'s properties
     */
    toSimple(exclude = []) {
        const simple = {};
        Segment.#props.forEach(prop => {
            if (!exclude.includes(prop)) {
                // honestly I can't remember why it's like this but I think
                // otherwise it sets simple[prop] to the getters and not the values??
                if (this.segment[prop]) { simple[prop] = this.segment[prop]; }
                else { simple[prop] = this[prop]; }
            }
        });
        return simple;
    }

    /**
     * Copies this `Segment` to a `Group`
     * @param {Group} copyParent - `Group` to add the copy to
     * @returns {(Segment|null)} Null if `copyParent` already has a copy of this `Segment`, otherwise the copied `Segment`
     */
    copy(copyParent) {
        // only copy if the new parent doesn't already have a copy of the segment
        if (!copyParent.children.some(child => propertiesEqual(this.segment, child.segment, ["startTime", "endTime"]))) {
            const newSegment = peaks.segments.add(this.toSimple(["id", "path"]));
            return new Segment(newSegment, { parent: copyParent, text: this.text, removable: true, renamable: true, moveTo: ["Labeled"] });
        }
        return null;
    }


    // Moveable and Copyable interface???? Because Group is gonna use this exact same functionality, no need to write it twice


    /** */
    expandMoveTo() {
        const moveToAsTreeItems = TreeItem.idsToTreeItems(this.moveTo);
        const expanded = Segment.#expand(moveToAsTreeItems, [this.parent.id]);
        return TreeItem.treeItemsToIds(expanded);
    }
    /** */
    expandCopyTo() {
        const copyToAsTreeItems = TreeItem.idsToTreeItems(this.copyTo);
        const expanded = Segment.#expand(copyToAsTreeItems, [this.parent.id]);
        return TreeItem.treeItemsToIds(expanded);
    }

    /** Initialize the CSS styling of the `Segment` */
    style() {
        this.li.style.fontSize = "12px";
        this.checkbox.style.transform = "scale(0.85)";
    }

    rename(newText) {
        super.text = newText;
        if (this.parent) { this.segment.update({ labelText: `${this.parent.id}\n${newText}` }); }
        else { this.segment.update({ "labelText": newText }); }
    }

    /** Removes this `Segment` from the tree and from Peaks */
    remove() {
        const id = this.id;
        const parent = this.parent;

        if (parent.hidden[id]) { delete parent.hidden[id]; }
        else { delete parent.visible[id]; }

        if (peaks.segments.getSegment(id) === this.segment) { peaks.segments.removeById(id); }

        super.remove();
    }

    /**
     * Toggles the item in the tree and hides/unhides this `Segment` from the Peaks waveform
     * @param {boolean=} force - If given, forces the item to toggle on/off. If true, force checks the checkbox, turns on the buttons, and unhides the segment in Peaks. If false, force unchecks the checkbox, turns off the buttons, and hides the segment in Peaks. If force equals this.checked, no toggling is done.
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return; }  // force == this.checked so no toggling necessary

        const id = this.id;
        const parent = this.parent;
        const checked = force === null ? this.checked : force;

        if (checked) {  // add segment to peaks
            peaks.segments.add(this.segment);
            delete parent.hidden[id];
            parent.visible[id] = this;
        }
        else {  // remove segment from peaks
            peaks.segments.removeById(id);
            delete parent.visible[id];
            parent.hidden[id] = this;
        }
    }

    /**
     * Plays the segment
     * @param {boolean} [loop=false] - If true, loops the segment
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

            const pause = function () { peaks.player.pause(); }  // make function here so event listener can be removed
            button.addEventListener("click", pause, { once: true });
            // triggered by clicking pause button in tree, pause button on media controls, or play on other tree item
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? segmentIcons.loop : segmentIcons.play;
                button.removeEventListener("click", pause);  // event listener might still be on button so remove
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only emits pause event if playing when paused, so have to play audio if not already
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }

    /** Updates the duration using the segment's start and end times */
    updateDuration() {
        const newDuration = this.endTime - this.startTime;
        const durationChange = newDuration - this.duration;
        this.duration = newDuration;
        this.updateSpanTitle();
        if (this.parent) { this.parent.updateDuration(durationChange); }
    }

    /** Updates the title of the span */
    updateSpanTitle() {
        this.span.title = `Start time: ${this.startTime.toFixed(2)}\nEnd time: ${this.endTime.toFixed(2)}\nDuration: ${this.duration.toFixed(2)}`;
    }
}

export { TreeItem, Popup, Groups, Group, Segment };