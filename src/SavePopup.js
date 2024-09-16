import globals from "./globals.js";
import { notification } from "./Notification.js";
import { TreeItem } from "./treeClasses.js";
import { checkResponseStatus, getUrl, html } from "./util.js";

/** The popup containing extra settings for configuring the interface. */
const SavePopup = class SavePopup {
  /**
   * The div element that contains all other elements.
   * Displayed when the settings button is clicked.
   * @type {!HTMLDivElement}
   */
  popup;

  /**
   * The div element containing the actual content of the popup.
   * @type {!HTMLDivElement}
   */
  popupContent;

  /** @type {!HTMLAnchorElement} */ closeButton;
  /** @type {!HTMLSelectElement} */ branchSelect;
  /** @type {!HTMLInputElement} */ newBranchCheckbox;
  /** @type {!HTMLInputElement} */ newBranchInput;
  /** @type {!HTMLTextAreaElement} */ commitMessageTextarea;
  /** @type {!HTMLButtonElement} */ saveButton;

  /**
   * The index of the current branch in the branch select dropdown.
   * @type {number}
   */
  currentBranchIndex;

  constructor() {
    this.popup = html`<div class="popup"></div>`;
    document.body.append(this.popup);

    // matches any string that is not an existing branch name
    // used to validate new branch names in newBranchInput
    const pattern = `^(?!(${[...globals.allBranches].join("|")})$).*`;

    const popupContent = html`<div class="popup-content">
      <a class="close">&times</a>
      <select style="float: left;"></select>
      <br />
      <br />
      <label
        ><input type="checkbox" autocomplete="off" /> Save to new branch</label
      >
      <br />
      <label style="display: none;"
        >New Branch Name: <input type="text" pattern="${pattern}"
      /></label>
      <br />
      <label>Commit message: <textarea required></textarea></label>
      <br />
      <br />
      <button>Save</button>
    </div>`;

    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);

    this.closeButton = popupContent.children[0];
    this.branchSelect = popupContent.children[1];
    this.newBranchCheckbox = popupContent.children[4].firstElementChild;
    const newBranchLabel = popupContent.children[6];
    this.newBranchInput = newBranchLabel.firstElementChild;
    this.commitMessageTextarea = popupContent.children[8].firstElementChild;
    this.saveButton = popupContent.children[11];

    globals.allBranches.forEach((branch) => {
      const option = html`<option>${branch}</option>`;
      this.branchSelect.add(option);
    });
    this.currentBranchIndex = [...this.branchSelect.options].findIndex(
      (option) => option.text === globals.currentVersion.branch,
    );

    this.closeButton.addEventListener("click", () => this.hide());
    this.newBranchCheckbox.addEventListener("change", () => {
      if (this.newBranchCheckbox.checked) {
        // hide the dropdown, don't need it
        this.branchSelect.style.display = "none";
        newBranchLabel.style.display = "inline-block";
        this.newBranchInput.required = true; // make sure they enter a branch name
      } else {
        this.branchSelect.style.display = "inline-block";
        newBranchLabel.style.display = "none";
        this.newBranchInput.required = false; // don't need to enter a branch name
      }
    });
    this.saveButton.addEventListener("click", async () => this.save());
  }

  /**
   * Checks if the save form is valid and displays custom error messages if it's not.
   * @returns {boolean} Whether the form is valid.
   */
  reportValidity() {
    const nbInput = this.newBranchInput;
    const cmTextarea = this.commitMessageTextarea;

    if (
      (!nbInput.required || nbInput.validity.valid) &&
      cmTextarea.validity.valid
    ) {
      return true;
    }

    if (nbInput.validity.valueMissing) {
      nbInput.setCustomValidity("Please enter a branch name.");
    } else if (nbInput.required && nbInput.validity.patternMismatch) {
      // only show this error if the input is required since it's not used otherwise
      nbInput.setCustomValidity("Branch name can't be an existing branch.");
    } else {
      nbInput.setCustomValidity("");
    }

    if (cmTextarea.validity.valueMissing) {
      cmTextarea.setCustomValidity("Please enter a commit message.");
    } else {
      cmTextarea.setCustomValidity("");
    }

    nbInput.reportValidity();
    cmTextarea.reportValidity();
    return false;
  }

  async save() {
    if (!this.reportValidity()) {
      return;
    }

    const branch = this.newBranchCheckbox.checked
      ? this.newBranchInput.value
      : globals.currentVersion.branch;
    const message = this.commitMessageTextarea.value;

    const analysisChildren = TreeItem.byId.Analysis.children;
    const activeFaces = TreeItem.byId.ActiveFaces.children;

    const annotations = {
      formatVersion: 3,
      annotations: analysisChildren
        .map((child) => child.toObject())
        .filter((obj) => obj), // filter out nulls
      notes: document.getElementById("notes").value,
      active_faces: activeFaces.map((child) => child.toObject()),
    };

    const annotsFile = getUrl(
      "annotations",
      globals.basename,
      "-annotations.json",
      globals.folder,
    );
    const annotsUrl = new URL(annotsFile, window.location.href);

    // this is only used if globals.type === "views"
    // don't need to worry about globals.folder since view can't be in a folder
    const propagateFile = `/propagate/${globals.basename}-annotations.json`;
    const propagateUrl = new URL(propagateFile, window.location.href);

    const headers = { "Content-Type": "application/json; charset=UTF-8" };
    const body = JSON.stringify({ branch, message, annotations });

    let newVersion;
    // use try-catch instead of .catch() because we want to return if there's
    // an error, can't do that with .catch() because it's a callback
    try {
      newVersion = await fetch(annotsUrl, { method: "POST", headers, body })
        .then(checkResponseStatus)
        .then((res) => res.json());

      if (globals.type === "views") {
        await fetch(propagateUrl, { method: "POST", headers, body }).then(
          checkResponseStatus,
        );
      }
    } catch (err) {
      console.error(err);
      notification.show("Error saving changes.", "alert");
      return;
    }

    const newVersionUrl = new URL(window.location);
    newVersionUrl.searchParams.delete("branch");
    newVersionUrl.searchParams.set("commit", newVersion.commit);
    newVersion.url = newVersionUrl.toString();
    newVersion.datetime = new Date(newVersion.datetime);

    // insert at beginning of array because latest version is always first
    globals.versions.unshift(newVersion);
    globals.currentVersion = newVersion;
    globals.fileBranches.add(branch);
    globals.allBranches.add(branch);
    globals.dirty = false;
    document.getElementById("file").innerHTML = `${globals.filename} - Saved`;

    // update UI
    this.hide();
    // update the branch select dropdown
    const option = html`<option>${branch}</option>`;
    this.branchSelect.add(option, 0);
    this.branchSelect.selectedIndex = 0;
    this.currentBranchIndex = 0;

    notification.show("Changes saved.");
  }

  /** Updates content and displays this popup. */
  show() {
    this.branchSelect.selectedIndex = this.currentBranchIndex;
    this.popup.style.display = "block";
  }

  /** Hides this popup. */
  hide() {
    this.popup.style.display = "none";
  }
};

export default SavePopup;
