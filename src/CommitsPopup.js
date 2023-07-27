import globals from "./globals.js";
import { html } from "./util.js";

const getTimeAgoSpan = (date) => {
  const now = new Date();
  const diff = Math.abs(now - date);
  const minutes = Math.floor(diff / 1000 / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // undefined so that browser default is used for locale
  const dateStr = date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // If the commit is more than 30 days old, show the date
  if (days > 30) {
    return `<span class="time-ago">(${dateStr})</span>`;
  }

  // otherwise, show readable time difference and put the date in a tooltip
  let timeAgo;
  if (minutes < 1) {
    timeAgo = "just now";
  } else if (minutes < 60) {
    timeAgo = `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  } else if (hours < 24) {
    timeAgo = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  } else {
    timeAgo = `${days} day${days !== 1 ? "s" : ""} ago`;
  }
  return `<span class="time-ago" title="${dateStr}">${timeAgo}</span>`;
};

/** The popup containing extra settings for configuring the interface. */
const CommitsPopup = class CommitsPopup {
  static #makeVersionElement = (ver) => {
    return html`<div class="commit">
      <div class="message">
        <a href="${ver.url}" class="commit-link">${ver.message}</a>
      </div>
      <span class="author-name">${ver.user}</span>
      ${getTimeAgoSpan(ver.datetime)}
    </div>`;
  };

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

  /** @type {!HTMLAnchorElement} */ closeButton;
  /** @type {!HTMLSelectElement} */ branchSelect;
  /** @type {!HTMLDivElement} */ commitsDiv;

  /**
   * The index of the current branch in the branch select dropdown.
   * @type {number}
   */
  currentBranchIndex;

  /**
   * @type {import("./globals.js").VersionArray}
   */
  versions;

  /**
   * @type {Map<string, HTMLOptionElement>}
   */
  branchOptions;

  constructor() {
    this.popup = html`<div class="popup"></div>`;
    document.body.append(this.popup);

    const popupContent = html`<div class="popup-content">
      <a class="close">&times</a>
      <select style="float: left;"></select>
      <br />
      <br />
      <div class="commits"></div>
    </div>`;
    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);
    this.closeButton = popupContent.children[0];
    this.branchSelect = popupContent.children[1];
    this.commitsDiv = popupContent.children[4];
    this.closeButton.addEventListener("click", () => this.hide());
    this.branchSelect.addEventListener("change", () => this.updateEntries());

    // define and then use forEach instead of using map so that we can
    // add the commit hash as a property of the array within the forEach
    this.versions = [];
    globals.versions.forEach((ver) => {
      ver = { ...ver }; // copy the object
      ver.element = CommitsPopup.#makeVersionElement(ver);
      this.commitsDiv.appendChild(ver.element);
      this.versions.push(ver);
      this.versions[ver.commit] = ver;
    });

    this.branchOptions = new Map();
    globals.fileBranches.forEach((branch) => {
      const option = html`<option>${branch}</option>`;
      this.branchSelect.add(option);
      this.branchOptions.set(branch, option);
    });

    // Get the index of the current branch
    this.currentBranchIndex = [...this.branchSelect.options].findIndex(
      (option) => option.text === globals.currentVersion.branch
    );

    this.setCurrentVersion();
  }

  setCurrentVersion() {
    if (this.currentVersion) {
      this.currentVersion.element.style.border = "";
    }
    this.currentVersion = this.versions[globals.currentVersion.commit];
    this.currentVersion.element.style.border = "3px solid #a4f05d";
  }

  updateEntries() {
    const branch = this.branchSelect.value;

    if (this.versions.length !== globals.versions.length) {
      // versions were saved so the missing versions are at the front of
      // globals.versions (since they were the most recent versions)
      const newVersions = globals.versions
        .slice(0, globals.versions.length - this.versions.length)
        .map((ver) => {
          ver = { ...ver }; // copy the object
          ver.element = CommitsPopup.#makeVersionElement(ver);
          this.versions[ver.commit] = ver;
          return ver;
        });
      this.versions.unshift(...newVersions); // add to front of array
      this.commitsDiv.prepend(...newVersions.map((ver) => ver.element));
    }

    if (this.branchOptions.size !== globals.fileBranches.size) {
      // new branches were added (when a user saved to a new branch)
      globals.fileBranches.forEach((branch) => {
        if (!this.branchOptions.has(branch)) {
          const option = html`<option>${branch}</option>`;
          this.branchSelect.add(option);
          this.branchOptions.set(branch, option);
        }
      });
    }

    if (this.currentVersion.commit !== globals.currentVersion.commit) {
      this.setCurrentVersion();
    }

    this.versions.forEach((ver) => {
      ver.element.style.display = ver.branch === branch ? "block" : "none";
    });
  }

  /** Updates content and displays this popup. */
  show() {
    // default the dropdown to the current branch
    this.branchSelect.selectedIndex = this.currentBranchIndex;
    this.updateEntries();
    this.popup.style.display = "block";
  }

  /** Hides this popup. */
  hide() {
    this.popup.style.display = "none";
  }
};

export default CommitsPopup;
