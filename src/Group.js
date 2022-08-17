// console.log("in Group.js");

import TreeItem from "./treeItem";
import { groupIcons } from "./icon";
import { arrayMean, sortByProp } from "./util";
import globals from "./globals";

const peaks = globals.peaks;

const Group = class Group extends TreeItem {

    static byId = {};
    static icons = groupIcons;
    static rankSnrs() {
        const groups = Object.values(Group.byId).filter(group => group.snr);

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
        Group.byId[maxSpeaker].span.style.color = "violet";
    }

    snr;
    hidden = {};
    visible = {};

    constructor(id, { parent = null, children = null, snr = null, text = null, removable = false, checked = true, duration = 0 } = {}) {
        super(id, { parent, children, text, removable, checked, duration });

        Group.byId[id] = this;
        this.snr = snr;
        this.sort("startTime");
    }

    style() {
        this.li.style.fontSize = "18px";
    }

    remove() {
        delete Group.byId[this.id];
        super.remove();
    }

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

    updateSpanTitle() {
        if (this.snr) {
            this.span.title = `SNR: ${this.snr.toFixed(2)}\nDuration: ${this.duration.toFixed(2)}`;
        }
        else {
            super.updateSpanTitle();
        }
    }

    getSegments({ hidden = false, visible = false } = {}) {
        const segments = [];
        if (hidden) { segments.push(...Object.values(this.hidden)); }
        if (visible) { segments.push(...Object.values(this.visible)); }
        return segments;
    }
}

export default Group;