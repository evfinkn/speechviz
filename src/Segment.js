import globals from "./globals";
import TreeItem from "./TreeItem";
import { segmentIcons } from "./icon";

const peaks = globals.peaks;

const Segment = class Segment extends TreeItem {

    static byId = {};
    static icons = segmentIcons;
    static #highestId;
    static get highestId() {
        if (Segment.#highestId) { return Segment.#highestId; }
        const ids = Object.keys(Segment.byId);
        const idNums = ids.map(id => parseInt(id.split(".").at(-1)));
        Segment.#highestId = Math.max(...idNums);
        return Segment.#highestId;
    }
    static #props = ["startTime", "endTime", "editable", "color", "labelText", "id", "path", "treeText", "removable"];

    segment;

    constructor(segment, { parent = null, text = null, removable = false, checked = true } = {}) {
        text = text || segment.treeText;
        removable = segment.removable || removable;

        if (segment.labelText != text) {
            segment.update({ labelText: `${segment.labelText}\n${text}` });
        }

        super(segment.id, { parent, text, removable, checked, duration: segment.endTime - segment.startTime, props: { segment } });
        this.segment = segment;
        Segment.byId[segment.id] = this;
    }

    get startTime() { return this.segment.startTime; }
    get endTime() { return this.segment.endTime; }
    get editable() { return this.segment.editable; }
    get color() { return this.segment.color; }
    get labelText() { return this.segment.labelText; }
    update(options) { this.segment.update(options); }

    get parent() { return super.parent; }
    set parent(newParent) {
        const id = this.id;
        const parent = this.parent;
        if (parent) {
            if (parent.hidden[id]) { delete parent.hidden[id]; }
            else { delete parent.visible[id]; }
        }

        this.segment.update({ labelText: `${newParent.id}\n${this.text}` });  //, color: newParent.color });
        if (this.checked) { newParent.visible[this.id] = this; }
        else { newParent.hidden[this.id] = this; }
        super.parent = newParent;
    }

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

    style() {
        this.li.style.fontSize = "12px";
        this.checkbox.style.transform = "scale(0.85)";
    }

    remove() {
        const id = this.id;
        const parent = this.parent;

        if (parent.hidden[id]) { delete parent.hidden[id]; }
        else { delete parent.visible[id]; }

        if (peaks.segments.getSegment(id) === this.segment) { peaks.segments.removeById(id); }
        delete Segment.byId[id];
        super.remove();
    }

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

    updateDuration() {
        const newDuration = this.endTime - this.startTime;
        const durationChange = newDuration - this.duration;
        this.duration = newDuration;
        this.updateSpanTitle();
        this.parent.updateDuration(durationChange);
    }

    updateSpanTitle() {
        this.span.title = `Start time: ${this.startTime.toFixed(2)}\nEnd time: ${this.endTime.toFixed(2)}\nDuration: ${this.duration.toFixed(2)}`;
    }
}

export default Segment;