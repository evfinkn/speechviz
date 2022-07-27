import TreeItem from "./treeItem";
import { groupIcons } from "./icon";
import globals from "./globals";

const peaks = globals.peaks;

const Groups = class Groups extends TreeItem {

    static byId = {};
    static icons = groupIcons;

    constructor(id, { parent = null, children = null, text = null, removable = false, checked = true, duration = 0 } = {}) {
        super(id, { parent, children, text, removable, checked, duration});

        Groups.byId[id] = this;
    }

    getSegments({ hidden = false, visible = false } = {}) {
        const segments = [];
        this.children.forEach(function (child) {
            segments.push(...child.getSegments({ hidden, visible }));
        })
        return segments;
    }

    toggle(force = null) {
        if (!this.toggleTree(force)) { return; }
        this.children.forEach(function (child) { child.toggle(force); });
    }

    play(loop = false) {
        const segments = this.getSegments({ visible: true });
        if (segments.length == 0) { return; }

        // See Segment.play for reasoning behind event listener
        peaks.once("player.pause", function () {
            peaks.player.playSegments(segments, loop);
            const button = loop ? this.loop : this.play;
            button.innerHTML = groupIcons.pause;

            const pause = function () { peaks.player.pause(); }
            button.addEventListener("click", pause, { once: true });
            peaks.once("player.pause", function () {
                button.innerHTML = loop ? groupIcons.loop : groupIcons.play;
                button.removeEventListener("click", pause);
                button.addEventListener("click", function () { this.play(loop); }, { once: true });
            });
        });
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }
}

export default Groups;