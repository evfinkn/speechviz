import globals from "./globals";
import TreeItem from "./TreeItem";
import Group from "./Group";
import Groups from "./Groups";
import Popup from "./Popup";
import { segmentIcons } from "./icon";
import { propertiesEqual } from "./util";

const peaks = globals.peaks;

/**
 * Class representing a Peaks.js segment and its item in a tree
 * @extends TreeItem
 */
const Segment = class Segment extends TreeItem {

    /** An object containing all `Segment`s by their id. Key is id, value is corresponding `Segment`:  {id: `Segment`} */
    static byId = {};
    /** HTML strings for the play, pause, loop, and remove icons for `Segment`s in the tree */
    static icons = segmentIcons;
    static #highestId;
    /** 
     * The highest number id of all Segments 
     * @type {number}
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
     */
    static #props = ["startTime", "endTime", "editable", "color", "labelText", "id", "path", "treeText", "removable"];

    /**
     * A Peaks.js segment
     * @type {Peaks.Segment}
     */
    segment;
    /** Array of ids of `Group`s and `Groups`s that this segment can be moved to */
    moveTo;
    /** Array of ids of `Group`s and `Groups`s that this segment can be copied to */
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
        text = text || segment.treeText;
        removable = segment.removable != null ? segment.removable : removable;

        if (segment.labelText != text) {
            segment.update({ labelText: `${segment.labelText}\n${text}` });
        }

        // don't render yet because some methods rely on this.segment but can't use 'this' until after super() call
        super(segment.id, { text, removable, renamable, render: false });
        this.segment = segment;
        Segment.byId[segment.id] = this;

        this.render();
        this.updateDuration();
        this.parent = parent;

        this.moveTo = moveTo;
        this.copyTo = copyTo;

        if (this.renamable || this.moveTo || this.copyTo) {
            this.popup = new Popup(this);
            this.li.append(this.popup.popup);
        }
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
                if (this.segment[prop]) { simple[prop] = this.segment[prop]; }
                else {
                    simple[prop] = this[prop];
                }
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
        if (!copyParent.children.some(child => propertiesEqual(this.segment, child.segment, ["startTime", "endTime"]))) {
            const newSegment = peaks.segments.add(this.toSimple(["id", "path"]));
            return new Segment(newSegment, { parent: copyParent })
        }
        return null;
    }


    // Moveable and Copyable interface???? Because Group is gonna use this exact same functionality, no need to write it twice

    
    /** */
    expandMoveTo() {
        const moveToAsTreeItems = TreeItem.idsToTreeItems(this.moveTo);
        const expanded = Groups.expand(moveToAsTreeItems, [this.parent.id]);
        return TreeItem.treeItemsToIds(expanded);
    }
    /** */
    expandCopyTo() {
        const copyToAsTreeItems = TreeItem.idsToTreeItems(this.copyTo);
        const expanded = Groups.expand(copyToAsTreeItems, [this.parent.id]);
        return TreeItem.treeItemsToIds(expanded);
    }

    /** Initialize the CSS styling of the `Segment` */
    style() {
        this.li.style.fontSize = "12px";
        this.checkbox.style.transform = "scale(0.85)";
    }

    rename(newText) {
        super.text = newText;
        this.segment.update({ "labelText": newText });
    }

    /** Removes this `Segment` from the tree and from Peaks */
    remove() {
        const id = this.id;
        const parent = this.parent;

        if (parent.hidden[id]) { delete parent.hidden[id]; }
        else { delete parent.visible[id]; }

        if (peaks.segments.getSegment(id) === this.segment) { peaks.segments.removeById(id); }
        delete Segment.byId[id];
        super.remove();
    }

    /**
     * Toggles the item in the tree and hides/unhides this `Segment` from the Peaks waveform
     * @param {boolean=} force - If given, forces the item to toggle on/off. If true, force checks the checkbox, turns on the buttons, and unhides the segment in Peaks. If false, force unchecks the checkbox, turns off the buttons, and hides the segment in Peaks. If force equals this.checked, no toggling is done.
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return; }

        const id = this.id;
        const parent = this.parent;
        const checked = force === null ? this.checked : force;

        if (checked) {
            peaks.segments.add(segment);
            delete parent.hidden[id];
            parent.visible[id] = this;
        }
        else {
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
        // a play button.
        peaks.once("player.pause", () => {
            peaks.player.playSegment(this.segment, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = segmentIcons.pause;

            const pause = function () { peaks.player.pause(); }
            button.addEventListener("click", pause, { once: true });
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? segmentIcons.loop : segmentIcons.play;
                button.removeEventListener("click", pause);
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only pauses if playing, so have to play audio if not already
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

export default Segment;