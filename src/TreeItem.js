import { groupIcons } from "./icon";
import { htmlToElement, sortByProp, toggleButton } from "./util";

/** Class representing an item in a tree */
const TreeItem = class TreeItem {

    /** An object containing all `TreeItem`s by their id. Key is id, value is corresponding `TreeItem`:  {id: `TreeItem`} */
    static byId = {};
    /** 
     * Checks if a TreeItem by the given id exists
     * @param {string} id - id to check existence of
     * @returns {boolean} True if a TreeItem with `id` exists, false otherwise
     */
    static exists(id) { return id in TreeItem.byId; }
    /** HTML strings for the play, pause, loop, and remove icons for `TreeItem`s in the tree */
    static icons = groupIcons;

    /** The unique identifier of this `TreeItem` */
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
    /** Boolean indicating if this can be removed from the tree */
    removable;
    /** How long this `TreeItem`'s audio lasts, in seconds */
    duration = 0;

    /**
     * The li of this `TreeItem`
     * @type {Element}
     */
    li;
    /**
     * 
     * @type {Element}
     */
    checkbox;
    /**
     * 
     * @type {Element}
     */
    span;
    /**
     * 
     * @type {Element}
     */
    playButton;
    /**
     * The svg of the play button icon
     * @type {Element}
     */
    playSvg;
    /**
     * The a element of the loop button
     * @type {Element}
     */
    loopButton;
    /**
     * The svg of the loop button icon
     * @type {Element}
     */
    loopSvg;
    /**
     * If this `TreeItem` is removable, the a element of the remove button. Otherwise, null
     * @type {(Element|null)}
     */
    removeButton;
    /**
     * If this `TreeItem` is removable, the svg of the remove button icon. Otherwise, null
     * @type {(Element|null)}
     */
    removeSvg;
    /**
     * The ul element containing the nested content (the children) of this `TreeItem`
     * @type {Element}
     */
    nested;

    /**
     * @param {string} id - The unique identifier to give the `TreeItem`
     * @param {Object} options - An object containing options
     * @param {TreeItem=} options.parent - The `TreeItem` this `TreeItem` belongs to
     * @param {TreeItem[]=} options.children - An array of `TreeItem`s to put in this' nested content
     * @param {string=} options.text - The text to display in the tree. If null, uses `id` instead
     * @param {boolean} [options.removable=false] - Boolean indicating if this can be removed from the tree
     * @param {boolean} [options.render=true] - If true, calls render() in constructor. Otherwise, render() is not called
     * @throws Throws an error if a `TreeItem` with `id` already exists
     */
    constructor(id, { parent = null, children = null, text = null, removable = false, render = true } = {}) {
        if (TreeItem.exists(id)) {
            throw new Error(`A TreeItem with the id ${id} already exists`);
        }

        TreeItem.byId[id] = this;

        this.id = id;

        this.#text = text || id;
        this.removable = removable;

        if (render) { this.render(); }
        if (parent) { this.parent = parent; }

        if (children) { children.forEach(function (child) { this.addChild(child); }); }
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
    set text(newText) {
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

        const li = htmlToElement(`<li><input type="checkbox" autocomplete="off" checked><span>${this.#text}</span> <a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.play}   </a><a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.loop}   </a><ul class="nested active"></ul></li>`);
        this.li = li;

        this.checkbox = li.firstElementChild;
        this.checkbox.addEventListener("click", () => { this.toggle(); });

        this.span = li.children[1];
        this.span.addEventListener("click", () => { this.popup(); });
        this.updateSpanTitle();

        // segment play/loop buttons
        this.playButton = li.children[2];
        this.loopButton = li.children[3];
        this.playButton.addEventListener("click", () => { this.play() }, { once: true });
        this.loopButton.addEventListener("click", () => { this.play(true) }, { once: true });

        this.playSvg = this.playButton.firstElementChild;
        this.loopSvg = this.loopButton.firstElementChild;

        this.nested = li.children[4];

        if (this.removable) {
            const remove = htmlToElement(`<a href="javascript:;" ">${this.constructor.icons.remove}</a>`);
            this.loopButton.after(remove);
            remove.addEventListener("click", () => { this.remove(); });
            this.removeButton = remove;
            this.removeSvg = remove.firstElementChild;
        }

        // this is here for subclasses to define a style method if they want to apply specific CSS styles
        this.style?.();
    }

    // /** Initialize the CSS styling of the `TreeItem` */
    // style() {
    //     ;
    // }

    /**
     * Renames the `TreeItem`, replacing its id and text in the tree
     * @param {String} newId - The new id
     */
    rename(newId) {
        if (TreeItem.exists(newId)) {
            throw new Error(`A TreeItem with the id ${id} already exists`);
        }
        delete TreeItem.byId[this.id];
        delete this.constructor.byId[this.id];
        TreeItem.byId[newId] = this;
        this.constructor.byId[newId] = this;
        this.id = newId;
        this.text = newId;
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

    /**
     * Adds a `TreeItem` to this `TreeItem`'s nested content
     * @param {TreeItem} child - `TreeItem` to be nested
     */
    addChild(child) {
        child.parent = this;
    }

    /**
     * Adds `TreeItem`s to this `TreeItem`'s nested content
     * @param {TreeItem[]} children - Array of `TreeItem`s to be nested
     */
    addChildren(children) {
        children.forEach(function (child) { child.parent = this; });
    }

    /** Removes this `TreeItem` from the tree */
    remove() {
        this.li.remove();
        delete TreeItem.byId[this.id];
        this.children.forEach(function (child) { child.remove(); });
        if (this.#parent) { delete this.#parent.children[this.id]; }
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

export default TreeItem;