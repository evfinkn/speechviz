import TreeItem from "./treeItem";
import { groupIcons } from "./icon";
import globals from "./globals";
import { sortByProp } from "./util";

const peaks = globals.peaks;

/**
 * Class representing a group of `Group`s
 * @extends TreeItem
 */
const Groups = class Groups extends TreeItem {

    /** An object containing all `Groups`' by their id. Key is id, value is corresponding `Groups`:  {id: `Groups`} */
    static byId = {};
    /** HTML strings for the play, pause, loop, and remove icons for `Groups` in the tree */
    static icons = groupIcons;

    /**
     * @param {string} id - The unique identifier to give this `Groups`
     * @param {Object} options - An object containing options
     * @param {Groups=} options.parent - The `Groups` object this `Groups` belongs to
     * @param {Group[]=} options.children - An array of `Group`s to put in this `Groups`
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
            segments.push(...child.getSegments({ hidden, visible }));
        })
        return segments;
    }

    /**
     * Toggles the item in the tree and hides/unhides all of this `Groups`' segments from the Peaks waveform
     * @param {boolean=} force - If given, forces the item to toggle on/off. If true, force checks the checkbox, turns on the buttons, and unhides the segments in Peaks. If false, force unchecks the checkbox, turns off the buttons, and hides the segments in Peaks. If force equals this.checked, no toggling is done.
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return; }
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

        // See Segment.play for reasoning behind event listener
        peaks.once("player.pause", () => {
            peaks.player.playSegments(segments, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = groupIcons.pause;

            const pause = function () { peaks.player.pause(); }
            button.addEventListener("click", pause, { once: true });
            peaks.once("player.pause", () => {
                button.innerHTML = loop ? groupIcons.loop : groupIcons.play;
                button.removeEventListener("click", pause);
                button.addEventListener("click", () => { this.play(loop); }, { once: true });
            });
        });
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }
}

export default Groups;