import { compareProperty, getRandomColor } from "./util";
import peaks from "./runPeaks";
import { groupIcons } from "icons";
import Segment from "./OldSegment";

const Group = class Group {

    static groups = {};
    static snrs = {};
    static durations = {};
    static exists(name) { return name in this.groups; }

    name;
    path;
    parent;

    children = {};
    visibile = {};
    hidden = {};

    checked = true;
    color = getRandomColor();
    removable;
    snr;
    duration;
    #groupOfGroups = null;

    li;
    checkbox;
    span;
    playButton;
    playSvg;
    loopButton;
    loopSvg;
    removeButton;
    removeSvg;
    nested;

    constructor(name, path, children, { removable = false, snr = null, groupOfGroups = false }) {
        if (!Group.exists(name)) {
            this.name = name;

            this.path = path;
            const parent = path.at(-1);
            this.parent = parent;
            parent.children[name] = this;

            this.removable = removable;

            if (snr) {
                this.snr = snr;
                Group.snrs[name] = snr;
            }

            Group.durations[name] = 0;

            this.#groupOfGroups = groupOfGroups;

            Group.groups[name] = this;

            this.render();

            if (children.length > 0) {
                const childPath = this.path.concat(this);
                if (!Array.isArray(children[0]) && !groupOfGroups) {
                    this.#groupOfGroups = false;
                    const segments = peaks.segments.add(children);
                    this.color = segments[0].color;
                    segments.forEach(function (segment) {
                        this.addChild(new Segment(segment, childPath));
                    });
                }
                else {
                    this.#groupOfGroups = true;
                    for (const [nestedName, nestedChildren, nestedSNR] of children) {
                        this.addChild(nestedName, childPath, nestedChildren, { removable: removable, snr: nestedSNR })
                    }
                }

                if (child[0] instanceof Group) {
                    this.#groupOfGroups = true;
                    children.forEach(function (child) { this.addChild(child); });
                }
            }
        }
    }

    addChild(child) {
        this.children[child.id || child.name] = child;
        this.updateDuration(child.duration);

        if (this.#groupOfGroups === null) {
            this.#groupOfGroups = child instanceof Group;
        }

        if (!this.#groupOfGroups) {
            if (this.checked) { this.visible[child.id] = child; }
            else { this.hidden[child.id] = child; }
        }
        if (child.checked != this.checked) { child.toggle(); }
    }

    removeChild(child) {
        this.updateDuration(child.duration);
        child.remove()
        this.sortTree();
    }

    getSegments({ hidden = false, visible = false } = {}) {
        let segments = [];
        if (this.#groupOfGroups) {
            for (const child of Object.values(this.children)) {
                segments.push(...child.getSegments(arguments[0]));
            }
        }
        else {
            if (hidden) { segments.push(...this.hidden); }
            if (visible) { segments.push(...this.visible); }
        }
        return segments;
    }

    /**
    * sorts segments in the tree consecutively
    */
    sortTree() {
        if (this.#groupOfGroups) { return; }

        const segments = this.children;
        const temp = document.createElement("ul");
        const tree = this.nested;

        segments.sort((seg1, seg2) => compareProperty(seg1, seg2, "startTime"));
        segments.forEach(function (segment) {
            temp.append(document.getElementById(segment.id));
        });

        tree.innerHTML = "";
        const children = Array.from(temp.children).reverse();
        for (let i = children.length - 1; i >= 0; i--) {
            tree.append(children[i]);
        };
    }

    render() {
        const name = this.name;
        const li = htmlToElement(`<li id="${name}" style="font-size:18px;"></li>`);

        let spanHTML;
        if (this.snr) {
            spanHTML = `<button id="${name}-button" class="nolink"><span id="${name}-span" style="font-size:18px;" title="SNR: ${this.snr.toFixed(2)}\nDuration: 0.00">${name}</span></button>`;
        }
        else { spanHTML = `<span id="${name}-span" style="font-size:18px;">${name}</span>`; }
        li.innerHTML = `<input type="checkbox" autocomplete="off">${spanHTML} <a href="#" style="text-decoration:none;">${groupIcons.play}   </a><a href="#" style="text-decoration:none;">${groupIcons.loop}   </a><ul id="${name}-nested" class="nested"></ul>`;

        this.li = li;
        this.parent.nested.append(li);

        this.checkbox = li.firstElementChild;
        this.checkbox.addEventListener("click", function () { this.toggle(); });

        const span = li.children[1];
        this.span = span;
        if (this.snr) { span.parentElement.addEventListener("click", function () { this.popup(); }); }

        this.playButton = li.children[2];
        this.loopButton = li.children[3];
        this.playButton.addEventListener("click", function () { this.play(); }, { once: true });
        this.loopButton.addEventListener("click", function () { this.play(true); }, { once: true });

        this.playSvg = this.playButton.firstElementChild;
        this.loopSvg = this.loopButton.firstElementChild;

        this.nested = li.children[4];

        if (this.removable) {
            const remove = htmlToElement(`<a href="#">${groupRemoveIcon}</a>`);
            this.loopButton.after(remove);
            remove.addEventListener("click", function () { this.remove(); });
            this.removeButton = remove;
            this.removeSvg = remove.firstElementChild;
        }
    }

    remove() {
        this.children.forEach(function (child) { child.remove(); });
        this.li.remove();
        delete Group.groups[this.name];
    }

    updateDuration(durationChange) {
        const duration = this.duration + durationChange;
        this.duration = duration;
        Group.durations[this.name] = duration;

        if (this.snr) { this.span.title = `SNR: ${this.snr}\nDuration: ${duration}`; }
        else { this.span.title = `Duration: ${duration}`; }
        
        if (this.parent) { this.parent.updateDuration(durationChange); }
    }

    play(loop = false) {
        // Have to put in event listener because need to call
        // peaks.player.pause() to switch other pause buttons 
        // back to play buttons, but pausing without
        // the event listener instantly changes the new pause
        // button (from this function call) to change back to
        // a play button.
        peaks.once("player.pause", function () {
            peaks.player.playSegments(this.visible, loop);
            const button = loop ? this.loopButton : this.playButton;
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

    // loop() { this.play(true); }

    toggle(checked = null) {
        checked = checked === null ? !this.checked : checked;
        this.checked = checked;
        this.checkbox.checked = checked;

        this.nested.classList.toggle("active");

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

            this.hidden.forEach(function (segment) {
                segment.checkbox.checked = checked;
            });
            peaks.segments.add(this.hidden);
            this.visible.push(...this.hidden);
            this.hidden = [];
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

            this.visible.forEach(function (segment) {
                segment.checkbox.checked = checked;
                peaks.segments.removeById(segment.id);
            });
            this.hidden.push(...this.visible);
            this.visible = [];
        }
    }
}

export default Group;