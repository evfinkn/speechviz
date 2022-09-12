import globals from "./globals";
import TreeItem from "./treeItem";
import { htmlToElement } from "./util";


const peaks = globals.peaks;

const Popup = class Popup {

    /**
     * 
     * @type {TreeItem}
     */
    treeItem;
    /**
     * 
     * @type {Element}
     */
    popup = htmlToElement("<div class='popup'><div class='popup-content'></div></div>");
    /**
     * 
     * @type {Element}
     */
    popupContent = popup.firstElementChild;
    /**
     * 
     * @type {(Element|null)}
     */
    renameInput;
    /** */
    moveTo;
    /** */
    moveRadios;
    /** */
    copyTo;
    /** */
    copyRadios;

    constructor(treeItem) {
        this.treeItem = treeItem;

        const popupContent = this.popupContent;

        popupContent.appendChild(htmlToElement(`<h2>${"Placeholder instructions"}</h2>`));
        const closeButton = htmlToElement("<a class='close'>&times</a>");
        popupContent.appendChild(closeButton);
        closeButton.addEventListener("click", () => this.hide());

        if (treeItem.renamable) {
            const renameInput = htmlToElement("<input type='text' value='" + treeItem.span.innerHTML + "'>");
            this.renameInput = renameInput;
            popupContent.appendChild(renameInput);
            renameInput.addEventListener("keypress", function (event) {
                if (event.key === "Enter") { treeItem.rename(renameInput.value); }
            });
        }

        if (treeItem.moveTo) {
            this.moveTo = [];
            this.moveRadios = {};
            this.updateMoveTo();
        }

        if (treeItem.copyTo) {
            this.copyTo = [];
            this.copyRadios = {};
            this.updateCopyTo();
        }
    }

    show() {
        if (this.moveTo) { this.updateMoveTo(); }
        if (this.copyTo) { this.updateCopyTo(); }

        this.popup.style.display = "block";
    }

    hide() { this.popup.style.display = "none"; }

    updateMoveTo() {
        const moveTo = this.moveTo;
        const newMoveTo = this.treeItem.expandMoveTo();
        newMoveTo.filter(dest => !moveTo.includes(dest)).forEach(dest => this.addMoveRadio(dest));
        moveTo.filter(dest => !newMoveTo.includes(dest)).forEach(dest => this.removeMoveRadio(dest));
    }
    updateCopyTo() {
        const copyTo = this.copyTo;
        const newCopyTo = this.treeItem.expandCopyTo();
        newCopyTo.filter(dest => !copyTo.includes(dest)).forEach(dest => this.addCopyRadio(dest));
        copyTo.filter(dest => !newCopyTo.includes(dest)).forEach(dest => this.removeCopyRadio(dest));
    }

    addMoveRadio(id) {
        const moveRadios = this.moveRadios;
        const moveRadiosKeys = Object.keys(moveRadios);
        const popupContent = this.popupContent;
        const dest = TreeItem.byId[id];

        const radioDiv = htmlToElement(`<div><input type="radio" name="${this.treeItem.id}-radios" id="${label}-radio" autocomplete="off"><label for="${id}-radio">${label}</label></div><br>`);

        if (moveRadiosKeys.length == 0) { popupContent.append(radioDiv); }
        else { moveRadios[moveRadiosKeys.at(-1)].after(radioDiv); }

        radioDiv.firstElementChild.addEventListener("change", () => {
            this.treeItem.parent = dest;
            this.hide();
        });

        this.moveTo.push(id);
        moveRadios[id] = radioDiv;
    }
    addCopyRadio(id) {
        const copyRadios = this.copyRadios;
        const copyRadiosKeys = Object.keys(copyRadios);
        const popupContent = this.popupContent;
        const dest = TreeItem.byId[id];

        const radioDiv = htmlToElement(`<div><input type="radio" name="${this.treeItem.id}-radios" id="${label}-radio" autocomplete="off"><label for="${id}-radio">${label}</label></div><br>`);

        if (copyRadiosKeys.length == 0) { popupContent.append(radioDiv); }
        else { copyRadios[copyRadiosKeys.at(-1)].after(radioDiv); }

        radioDiv.firstElementChild.addEventListener("change", () => {
            this.treeItem.copy(dest);
            this.hide();
        });

        this.copyTo.push(id);
        copyRadios[id] = radioDiv;
    }
    removeMoveRadio(id) {
        this.moveRadios[id].remove();
        delete this.moveRadios[id];
        this.moveTo = this.moveTo.filter(dest => dest != id);
    }
    removeCopyRadio(id) {
        this.copyRadios[id].remove();
        delete this.copyRadios[id];
        this.copyTo = this.copyTo.filter(dest => dest != id);
    }
}

export default Popup;