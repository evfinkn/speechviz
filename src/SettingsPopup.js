import globals from "./globals";
import { htmlToElement } from "./util";

const peaks = globals.peaks;
const overview = peaks.views.getView('overview');
const zoomview = peaks.views.getView('zoomview');

const SettingsPopup = class SettingsPopup {

    /** */
    static defaults = [
        {name: "amplitudeInput", event: "input", props: { value: "5" }},
        {name: "autoScrollInput", event: "change", props: { checked: true }},
        {name: "enableSeekInput", event: "change", props: { checked: true }}
    ];

    /** */
    popup;
    /** */
    popupContent;
    // save inputs so can set them when resetting to defaults
    amplitudeInput;
    autoScrollInput;
    enableSeekInput;
    resetMovedButton;
    resetAllButton

    constructor() {
        this.popup = htmlToElement("<div class='popup'></div>");
        document.body.append(this.popup);

        const popupContent = htmlToElement("<div class='popup-content'></div>");
        this.popupContent = popupContent;
        this.popup.appendChild(popupContent);

        const closeButton = htmlToElement("<a class='close'>&times</a>");
        popupContent.appendChild(closeButton);
        closeButton.addEventListener("click", () => this.hide());

        // setting to change size of waveform amplitudes (how tall the peaks of the waveform are)
        const amplitudes = { "0": 0, "1": 0.1, "2": 0.25, "3": 0.5, "4": 0.75, "5": 1, "6": 1.5, "7": 2, "8": 3, "9": 4, "10": 5 };

        const amplitudeDiv = htmlToElement("<div><label>Amplitude scale <input type='range' min='0' max='10' step='1'></label></div>")
        popupContent.append(amplitudeDiv);

        this.amplitudeInput = amplitudeDiv.firstElementChild.firstElementChild;
        this.amplitudeInput.addEventListener('input', function () {
            const scale = amplitudes[this.value];
            zoomview.setAmplitudeScale(scale);
            overview.setAmplitudeScale(scale);
        });

        // setting to enable auto-scroll (peaks viewer moves forward with audio)
        const autoScrollDiv = htmlToElement("<div><label><input type='checkbox' checked> Auto scroll</label></div>");
        popupContent.append(autoScrollDiv);

        this.autoScrollInput = autoScrollDiv.firstElementChild.firstElementChild;
        this.autoScrollInput.addEventListener('change', function () { zoomview.enableAutoScroll(this.checked); });

        // setting to enable seeking (clicking peaks to jump to a time)
        const enableSeekDiv = htmlToElement("<div><label><input type='checkbox' checked> Enable click to seek</label></div>");
        popupContent.append(enableSeekDiv);

        this.enableSeekInput = enableSeekDiv.firstElementChild.firstElementChild;
        this.enableSeekInput.addEventListener('change', function () {
            zoomview.enableSeek(this.checked);
            overview.enableSeek(this.checked);
        });

        const fetchOptions = {
            method: "DELETE",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ "user": globals.user, "filename": globals.filename, "highestId": globals.highestId })
        };  // fine to use same body for both requests because "reset" request will just ignore highestId

        // resets all of the pipeline segments that have been moved from one group to another
        this.resetMovedButton = htmlToElement("<button>Reset moved</button>");
        this.resetMovedButton.addEventListener("click", function () {
            if (confirm("This will reset all moved speaker segments.\nAre you sure you want to continue?")) {
                fetch("reset-moved", fetchOptions)
                    .then(res => {
                        if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
                        window.location.reload();
                    })
                    .catch(error => console.error(`Error while resetting moved: ${error}`));
            }
        });

        // deletes all saved segments
        this.resetAllButton = htmlToElement("<button>Reset all</button>");
        this.resetAllButton.addEventListener("click", function () {
            if (confirm("This will delete ALL saved segments.\nAre you sure you want to continue?")) {
                fetch("reset", fetchOptions)
                    .then(res => {
                        if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
                        window.location.reload();
                    })
                    .catch(error => console.error(`Error while resetting moved: ${error}`));
            }
        });

        popupContent.append(document.createElement("br"));
        popupContent.append(this.resetMovedButton);
        popupContent.append(document.createElement("br"));
        popupContent.append(this.resetAllButton);
    }

    /** */
    show() { this.popup.style.display = "block"; }

    /** */
    hide() { this.popup.style.display = "none"; }

    setToDefaults() {
        for (const { name, event, props } of SettingsPopup.defaults) {
            const input = this[name];
            Object.keys(props).forEach(key => input[key] = props[key]);
            input.dispatchEvent(new Event(event));
        }
    }
}

export default SettingsPopup;