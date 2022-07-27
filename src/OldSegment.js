import peaks from "./runPeaks";
import { segmentIcons } from "icon.js";
import { htmlToElement } from "./util";
import Group from "./OldGroup";

const Segment = class Segment {

    static segmentsByID = {};

    segment;
    id;
    path;
    parent;

    checked = true;
    treeText;
    removable;
    duration;

    li;
    checkbox;
    span;
    playButton;
    playSvg;
    loopButton;
    loopSvg;
    removeButton = null;
    removeSvg;

    constructor(segment, path) {
        this.segment = segment;
        const id = segment.id
        this.id = id;  // id doesn't change, so don't need getter like other seg properties

        this.path = path;  // path is a list of groups the segment belongs to
        const parent = path.at(-1);
        this.parent = parent;
        parent.children[id] = this;
        parent.visible[id] = this;

        // honestly at the moment I'm not sure if I should just leave these types
        // of properties in the peaks segment object or in this class but for now
        // I'm just gonna keep them in this class, so there's no point in also
        // having them in the segment object, so delete it from there if it has it
        this.treeText = segment.treeText || segment.id.replace("peaks.", "");
        if (segment.treeText) { delete segment.treeText; }

        this.removable = !!segment.removable;
        if (segment.removable) { delete segment.removable; }

        this.duration = segment.endTime - segment.startTime;

        Segment.segmentsByID[segment.id] = this;

        this.render();

        // // this allows us to define the 'get (target, prop)' method below,
        // // which will forward any property lookups to the actual peaks segment
        // // object if this isn't storing it
        // // https://stackoverflow.com/a/43323115
        // return new Proxy(this, this);
    }

    // get (target, prop) {
    //     return this[prop] || this.segment[prop];
    // }

    get startTime() { return this.segment.startTime; }
    get endTime() { return this.segment.endTime; }
    get editable() { return this.segment.editable; }
    get color() { return this.segment.color; }
    get labelText() { return this.segment.labelText; }
    update(options) { this.segment.update(options); }

    render() {
        const segment = this.segment;  // faster to store reference than to need to look it up every time
        const li = htmlToElement(`<li id="${segment.id}" style="font-size:12px;"><input style="transform:scale(0.85);" type="checkbox" autocomplete="off" checked><span id="${segment.id}-span" title="Duration: ${(segment.endTime - segment.startTime).toFixed(2)}">${segment.treeText}</span> <a href="#" style="text-decoration:none;">${segmentIcons.play}   </a><a href="#" style="text-decoration:none;">${segmentIcons.loop}   </a><ul id="${segment.id}-nested" class="nested active"></ul></li>`);
        this.li = li;
        this.parent.nested.append(li);

        // segment checkboxes
        this.checkbox = li.firstElementChild;
        this.checkbox.addEventListener("click", function () { this.toggle(); });

        this.span = li.children[1];
        this.span.addEventListener("click", function () { this.popup(); });

        // segment play/loop buttons
        this.playButton = li.children[2];
        this.loopButton = li.children[3];
        this.playButton.addEventListener("click", function () { this.play() }, { once: true });
        this.loopButton.addEventListener("click", function () { this.play(true) }, { once: true });

        this.playSvg = this.playButton.firstElementChild;
        this.loopSvg = this.loopButton.firstElementChild;

        if (segment.color != this.parent.color) { segment.update({ "color": this.parent.color }); }

        if (segment.editable || this.removable) {
            const remove = htmlToElement(`<a href="#" ">${segmentIcons.remove}</a>`);
            this.loopButton.after(remove);
            remove.addEventListener("click", function () { this.remove(); });
            this.removeButton = remove;
            this.removeSvg = remove.firstElementChild;
        }
    }

    remove() {
        const id = segment.id;
        const parent = this.parent;

        peaks.segments.removeById(id);
        delete Segment.segmentsByID[id];
        if (parent.hidden[id]) { delete parent.hidden[id]; }
        if (parent.visible[id]) { delete parent.visible[id]; }
        this.li.remove();
    }

    updateDuration() {
        const duration = this.segment.endTime - this.segment.startTime
        const durationChange = duration - this.duration;
        this.duration = duration;
        this.span.title = `Duration: ${duration.toFixed(2)}`;
        this.parent.updateDuration(durationChange);
    }

    play(loop = false) {
        // Have to put in event listener because need to call
        // peaks.player.pause() to switch other pause buttons 
        // back to play buttons, but pausing without
        // the event listener instantly changes the new pause
        // button (from this function call) to change back to
        // a play button.
        peaks.once("player.pause", function () {
            peaks.player.playSegment(this.segment, loop);
            const button = loop ? this.loopButton : this.playButton;
            button.innerHTML = segmentIcons.pause;

            const pause = function () { peaks.player.pause(); }
            button.addEventListener("click", pause, { once: true });
            peaks.once("player.pause", function () {
                button.innerHTML = loop ? segmentIcons.loop : segmentIcons.play;
                button.removeEventListener("click", pause);
                button.addEventListener("click", function () { this.play(loop); }, { once: true });
            });
        });
        // peaks.player.pause() only pauses if playing, so have to play audio if not already
        if (!peaks.player.isPlaying()) { peaks.player.play(); }
        peaks.player.pause();
    }

    toggle(checked = null) {
        const segment = this.segment;
        const id = this.id;

        checked = checked === null ? !this.checked : checked;
        this.checked = checked;
        this.checkbox.checked = checked;

        const parent = this.parent;
        if (checked) {
            this.playButton.style.pointerEvents = "auto";
            this.playSvg.style.stroke = "black";
            this.playSvg.style.fill = "black";

            this.loopButton.style.pointerEvents = "auto";
            this.loopSvg.style.stroke = "black";

            if (this.removeButton) {
                this.removeButton.style.pointEvents = "auto";
                this.removeSvg.style.stroke = "black";
            }

            peaks.segments.add(segment);
            parent.visible[id] = segment;
            delete parent.hidden[id];
        }
        else {
            this.playButton.style.pointerEvents = "none";
            this.playSvg.style.stroke = "gray";
            this.playSvg.style.fill = "gray";

            this.loopButton.style.pointerEvents = "none";
            this.loopSvg.style.stroke = "gray";

            if (this.removeButton) {
                this.removeButton.style.pointEvents = "none";
                this.removeSvg.style.stroke = "gray";
            }

            peaks.segments.removeById(id);
            parent.hidden[id] = segment;
            delete parent.visible[id];
        }
    }

    move(newParent) {}
}

export default Segment;