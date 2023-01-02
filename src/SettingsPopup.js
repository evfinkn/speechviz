import globals from "./globals.js";
import { Segment } from "./treeClasses.js";
import { checkResponseStatus, htmlToElement } from "./util.js";

const peaks = globals.peaks;
const overview = peaks.views.getView("overview");
const zoomview = peaks.views.getView("zoomview");

/**
 * An `Object` used to reset an input and setting back to its default values.
 * @typedef {Object} DefaultSetting
 * @prop {string} name - The name of the input of the setting.
 * @prop {string} event - The name of the event listened to by the input.
 * @prop {Object<string, any>} props - An `Object` containing the name and default
 *      value for the properties of the input.
 */

/** The popup containing extra settings for configuring the interface. */
const SettingsPopup = class SettingsPopup {
  /**
   * The default settings of every input and setting in the popup.
   * @type {Array.<DefaultSetting>}
   * @static
   */
  static defaults = [
    { name: "amplitudeInput", event: "input", props: { value: "5" } },
    { name: "autoScrollInput", event: "change", props: { checked: true } },
    { name: "enableSeekInput", event: "change", props: { checked: true } },
    { name: "showDragHandlesInput", event: "change", props: { checked: true } },
  ];

  /**
   * The div element that contains all other elements.
   * Displayed when the settings button is clicked.
   * @type {!Element}
   */
  popup;

  /**
   * The div element containing the actual content of the popup.
   * @type {!Element}
   */
  popupContent;

  // save inputs so can set them when resetting to defaults
  /**
   * The input element of the range that changes the amplitude of the waveform.
   * @type {!Element}
   */
  amplitudeInput;

  /**
   * The input element of the checkbox that enables / disables autoscrolling
   * on the waveform.
   * @type {!Element}
   */
  autoScrollInput;

  /**
   * The input element of the checkbox that enables / disables seeking on the
   * Peaks waveforms.
   * @type {!Element}
   */
  enableSeekInput;

  /**
   * The input element of the checkbox that shows / hides the segments' drag handles.
   * @type {!Element}
   */
  showDragHandlesInput;

  /**
   * The button element that resets all moved segments.
   * @type {!Element}
   */
  resetMovedButton;

  /**
   * The button element that resets all saved changes.
   * @type {!Element}
   */
  resetAllButton;

  constructor() {
    this.popup = htmlToElement("<div class='popup'></div>");
    document.body.append(this.popup);

    const popupContent = htmlToElement("<div class='popup-content'></div>");
    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);

    const closeButton = htmlToElement("<a class='close'>&times</a>");
    popupContent.appendChild(closeButton);
    closeButton.addEventListener("click", () => this.hide());

    // setting to change size of waveform amplitudes
    // (how tall the peaks of the waveform are)
    const amplitudes = {
      0: 0,
      1: 0.1,
      2: 0.25,
      3: 0.5,
      4: 0.75,
      5: 1,
      6: 1.5,
      7: 2,
      8: 3,
      9: 4,
      10: 5,
    };

    const amplitudeDiv = htmlToElement(`<div>
            <label>
              Amplitude scale <input type='range' min='0' max='10' step='1'>
            </label>
        </div>`);
    popupContent.append(amplitudeDiv);

    this.amplitudeInput = amplitudeDiv.firstElementChild.firstElementChild;
    this.amplitudeInput.addEventListener("input", function () {
      const scale = amplitudes[this.value];
      zoomview.setAmplitudeScale(scale);
      overview.setAmplitudeScale(scale);
    });

    // setting to enable auto-scroll (peaks viewer moves forward with audio)
    const autoScrollDiv = htmlToElement(`<div>
            <label><input type='checkbox' checked> Auto scroll</label>
        </div>`);
    popupContent.append(autoScrollDiv);

    this.autoScrollInput = autoScrollDiv.firstElementChild.firstElementChild;
    this.autoScrollInput.addEventListener("change", function () {
      zoomview.enableAutoScroll(this.checked);
    });

    // setting to enable seeking (clicking peaks to jump to a time)
    const enableSeekDiv = htmlToElement(`<div>
            <label><input type='checkbox' checked> Enable click to seek</label>
        </div>`);
    popupContent.append(enableSeekDiv);

    this.enableSeekInput = enableSeekDiv.firstElementChild.firstElementChild;
    this.enableSeekInput.addEventListener("change", function () {
      zoomview.enableSeek(this.checked);
      overview.enableSeek(this.checked);
    });

    // setting to show segments' drag handles
    const showDragHandlesDiv = htmlToElement(`<div>
            <label>
              <input type='checkbox' checked> Show segments' time drag handles
            </label>
        </div>`);
    popupContent.append(showDragHandlesDiv);

    this.showDragHandlesInput =
      showDragHandlesDiv.firstElementChild.firstElementChild;
    this.showDragHandlesInput.addEventListener("change", function () {
      Object.values(Segment.byId).forEach((segment) =>
        segment.toggleDragHandles(this.checked)
      );
    });

    // fine to use same body for both requests
    // because "reset" request will just ignore highestId
    const fetchOptions = {
      method: "DELETE",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        user: globals.user,
        filename: globals.filename,
        highestId: globals.highestId,
      }),
    };

    // resets all of the pipeline segments that
    // have been moved from one group to another
    this.resetMovedButton = htmlToElement("<button>Reset moved</button>");
    this.resetMovedButton.addEventListener("click", function () {
      if (
        confirm(
          "This will reset all moved speaker segments.\n" +
            "Are you sure you want to continue?"
        )
      ) {
        fetch("reset-moved", fetchOptions)
          .then(checkResponseStatus)
          .then(() => window.location.reload())
          .catch((error) =>
            console.error(`Error while resetting moved: ${error}`)
          );
      }
    });

    // deletes all saved segments
    this.resetAllButton = htmlToElement("<button>Reset all</button>");
    this.resetAllButton.addEventListener("click", function () {
      if (
        confirm(
          "This will delete ALL saved segments.\n" +
            "Are you sure you want to continue?"
        )
      ) {
        fetch("reset", fetchOptions)
          .then(checkResponseStatus)
          .then(() => window.location.reload())
          .catch((error) =>
            console.error(`Error while resetting moved: ${error}`)
          );
      }
    });

    popupContent.append(document.createElement("br"));
    popupContent.append(this.resetMovedButton);
    popupContent.append(document.createElement("br"));
    popupContent.append(this.resetAllButton);
  }

  /** Updates content and displays this popup. */
  show() {
    this.popup.style.display = "block";
  }

  /** Hides this popup. */
  hide() {
    this.popup.style.display = "none";
  }

  /** Sets the inputs and settings back to their defaults. */
  setToDefaults() {
    for (const { name, event, props } of SettingsPopup.defaults) {
      const input = this[name];
      Object.keys(props).forEach((key) => (input[key] = props[key]));
      input.dispatchEvent(new Event(event));
    }
  }
};

export default SettingsPopup;
