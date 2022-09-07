import TreeItem from "./treeItem";
import { groupIcons } from "./icon";
import { sortByProp } from "./util";
import globals from "./globals";

const peaks = globals.peaks;

/**
 * Class representing a group of `Segment`s
 * @extends TreeItem 
 */
const Group = class Group extends TreeItem {

    /** An object containing all `Group`s by their id. Key is id, value is corresponding `Group`:  {id: `Group`} */
    static byId = {};
    /** HTML strings for the play, pause, loop, and remove icons for `Group`s in the tree */
    static icons = groupIcons;
    /** Adds numbers next to `Group`s' text in the tree corresponding to their snr rank, with highest snr being highest rank */
    static rankSnrs() {
        const groups = Object.values(Group.byId).filter(group => group.snr !== null);

        const snrs = {};
        const durations = {};
        groups.forEach(function (group) {
            snrs[group.id] = group.snr;
            durations[group.id] = group.duration;
        });

        /* sortByProp(groups, "snr");
        for (let i = 0; i < groups.length; i++) {
            groups[i].text = `&#${(i <= 19 ? 9312 : 12861) + i} ${groups[i].text}`
        }

        const snrMean = arrayMean(Object.values(snrs));
        const durMean = arrayMean(Object.values(durations));

        const stdDev = (num, mean) => (num - mean) ** 2;
        const snrStdDev = Math.sqrt(arrayMean(Object.values(snrs), stdDev, snrMean));
        const durStdDev = Math.sqrt(arrayMean(Object.values(durations), stdDev, durMean)); */

        let snrMean = 0;
        let durMean = 0;
        let counter = 0;

        var snrArray = Object.entries(snrs);
        for (let i = 0; i < snrArray.length; i++) {
            for (let j = 0; j < snrArray.length - i - 1; j++) {
                if (snrArray[j + 1][1] > snrArray[j][1]) {
                    [snrArray[j + 1], snrArray[j]] = [snrArray[j], snrArray[j + 1]]
                }
            }
        }

        for (let i = 0; i < snrArray.length; i++) {
            const group = Group.byId[snrArray[i][0]]
            group.span.innerHTML = `&#${(i <= 19 ? 9312 : 12861) + i} ${group.span.innerHTML}`;
        }

        for (const key in snrs) {
            counter++;
            snrMean += snrs[key];
            durMean += durations[key];
        }
        snrMean /= counter;
        durMean /= counter;

        let snrStdDev = 0;
        let durStdDev = 0;
        for (const key in snrs) {
            snrStdDev += (snrs[key] - snrMean) ** 2;
            durStdDev += (durations[key] - durMean) ** 2;
        }
        snrStdDev /= counter;
        durStdDev /= counter;
        snrStdDev = Math.sqrt(snrStdDev);
        durStdDev = Math.sqrt(durStdDev);

        const snrZScores = {};
        const durZScores = {};
        for (const key in snrs) {
            snrZScores[key] = (snrs[key] - snrMean) / snrStdDev;
            durZScores[key] = (durations[key] - durMean) / durStdDev;
        }

        const overallZScores = {};
        for (const key in snrZScores) {
            overallZScores[key] = snrZScores[key] + durZScores[key];
        }

        let maxSpeaker = groups[0];
        let maxZ = overallZScores[maxSpeaker.id];
        for (const key of Object.keys(snrZScores)) {
            if (maxZ < overallZScores[key]) {
                maxSpeaker = key;
                maxZ = overallZScores[key];
            }
        }
        console.log(maxSpeaker);
        maxSpeaker.span.style.color = "violet";
    }

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
     * @param {string} id - The unique identifier to give this `Group`
     * @param {Object} options - An object containing options
     * @param {Groups=} options.parent - The `Groups` object this `Group` belongs to
     * @param {Segment[]=} options.children - An array of `Segment`s to put in this `Group`
     * @param {number=} options.snr - The signal-to-noise ratio
     * @param {string=} options.text - The text to display in the tree. If null, uses `id` instead
     * @param {boolean} [options.removable=false] - Boolean indicating if this can be removed from the tree
     * @throws Throws an error if a `TreeItem` with `id` already exists
     */
    constructor(id, { parent = null, children = null, snr = null, text = null, removable = false } = {}) {
        super(id, { parent, children, text, removable });

        Group.byId[id] = this;
        this.snr = snr;
        this.sort("startTime");
    }

    /** Initialize the CSS styling of the `Group` */
    style() {
        this.li.style.fontSize = "18px";
    }

    /** Removes this `Group` from the tree and from Peaks (removes all `Segment`s belonging to this `Group`) */
    remove() {
        delete Group.byId[this.id];
        super.remove();
    }

    /**
     * Toggles the item in the tree and hides/unhides all of this `Group`'s segments from the Peaks waveform
     * @param {boolean=} force - If given, forces the item to toggle on/off. If true, force checks the checkbox, turns on the buttons, and unhides the segments in Peaks. If false, force unchecks the checkbox, turns off the buttons, and hides the segments in Peaks. If force equals this.checked, no toggling is done.
     */
    toggle(force = null) {
        if (!this.toggleTree(force)) { return; }
        const checked = force === null ? this.checked : force;
        this.children.forEach(function (child) { child.toggleTree(checked); });
        if (checked) {
            peaks.segments.add(Object.values(this.hidden).map(hidden => hidden.segment));
            this.visible = Object.assign({}, this.visible, this.hidden);
            this.hidden = {};
        }
        else {
            Object.values(this.visible).forEach(function (segment) {
                peaks.segments.removeById(segment.id);
            });
            this.hidden = Object.assign({}, this.hidden, this.visible);
            this.visible = {};
        }
    }

    /**
     * Plays each `Segment` belonging to this `Group` in chronological order
     * @param {boolean} [loop=false] - If true, loops the `Group`
     */
    play(loop = false) {
        if (this.visible.length == 0) { return; }  // nothing to play, so don't add event listener

        const segments = sortByProp(Object.values(this.visible), "startTime");
        // See Segment.play for reasoning behind event listener
        peaks.once("player.pause", () => {
            peaks.player.playSegments(segments, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = groupIcons.pause;

            const pause = function () { peaks.player.pause(); }  // make function here so can be removed
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

    /** Updates the title of the span */
    updateSpanTitle() {
        if (this.snr) {
            this.span.title = `SNR: ${this.snr.toFixed(2)}\nDuration: ${this.duration.toFixed(2)}`;
        }
        else {
            super.updateSpanTitle();
        }
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
        if (hidden) { segments.push(...Object.values(this.hidden)); }  // array.push(...) is faster than using array.concat()
        if (visible) { segments.push(...Object.values(this.visible)); }
        return segments;
    }
}

export default Group;