import { groupIcons } from "./icon";
import { sortByProp, toggleButton } from "./util";

const TreeItem = class TreeItem {

    static byId = {};
    static exists(id) { return id in TreeItem.byId; }
    static icons = groupIcons;

    id;
    #parent;
    children = [];

    #text;
    removable;
    duration;

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

    constructor(id, { parent = null, children = null, text = null, removable = false, checked = true, duration = 0 } = {}) {
        if (TreeItem.exists(id)) {
            throw new Error(`A ${this.constructor} with the id ${id} already exists`);
        }

        TreeItem.byId[id] = this;

        this.id = id;

        this.#text = text || id;
        this.removable = removable;

        this.render();
        this.#parent = parent;
        this.updateDuration(duration);

        if (!checked || !parent?.checked) { this.toggle(); }

        children.forEach?.(function (child) { this.addChild(child); })
    }

    get parent() { return this.#parent; }
    set parent(newParent) {
        if (this.#parent) {
            delete this.#parent.children[this.id];
        }
        this.#parent = newParent;
        newParent.children.push(this);
        newParent.nested.append(this.li);
    }

    get text() { return this.#text; }
    set text(newText) {
        this.#text = newText;
        this.span.innerHTML = newText;
    }

    get checked() { return this.checkbox.checked; }
    set checked(bool) { this.checkbox.checked = bool; }

    render() {
        const id = this.id;

        this.li.remove?.();

        const li = htmlToElement(`<li id="${id}"><input type="checkbox" autocomplete="off" checked><span id="${id}-span">${this.#text}</span> <a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.play}   </a><a href="javascript:;" style="text-decoration:none;">${this.constructor.icons.loop}   </a><ul id="${id}-nested" class="nested active"></ul></li>`);
        this.li = li;

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

        this.nested = li.children[4];

        if (this.removable) {
            const remove = htmlToElement(`<a href="javascript:;" ">${this.constructor.icons.remove}</a>`);
            this.loopButton.after(remove);
            remove.addEventListener("click", function () { this.remove(); });
            this.removeButton = remove;
            this.removeSvg = remove.firstElementChild;
        }

        this.style();
    }

    sort(by) {
        const nested = this.nested;
        const children = sortByProp(this.children, by);
        children.forEach(function (segment) { nested.prepend(segment.li); });
    }

    addChild(child) {
        child.parent = this;
    }

    addChildren(children) {
        children.forEach(function (child) { child.parent = this; });
    }

    remove() {
        this.li.remove();
        delete TreeItem.byId[this.id];
        this.children.forEach(function (child) { child.remove(); });
        if (this.#parent) { delete this.#parent.children[this.id]; }
    }

    toggleTree(force = null) {
        if (force === this.checked) {
            return false;  // false indicates nothing changed (no toggling necessary)
        }

        const checked = force === null ? !this.checked : force;
        this.checked = checked;

        this.nested.classList.toggle("active", checked);

        toggleButton(this.playButton, checked);
        toggleButton(this.loopButton, checked);
        if (this.removeButton) { toggleButton(this.removeButton, checked); }

        this.children.forEach(function (child) { child.toggleTree(); });

        return true;  // true indicates things changed
    }

    toggle(force = null) { return this.toggleTree(force); }

    open() {
        this.nested.classList.add("active");
        this.#parent.open?.();
    }

    updateDuration(durationChange) {
        this.duration = this.duration + durationChange;
        this.updateSpanTitle();

        if (this.#parent) { this.#parent.updateDuration(durationChange); }
    }

    updateSpanTitle() {
        this.span.title = `Duration: ${this.duration.toFixed(2)}`;
    }
}

export default TreeItem;