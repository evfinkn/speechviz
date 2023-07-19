import globals from "./globals.js";
import { htmlToElement, checkResponseStatus } from "./util.js";

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

  constructor() {
    this.popup = htmlToElement("<div class='popup'></div>");
    document.body.append(this.popup);

    const popupContent = htmlToElement("<div class='popup-content'></div>");
    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);

    // Create the branch dropdown
    this.select = document.createElement("select");
    this.select.style.float = "left"; // Float the dropdown to the left
    popupContent.appendChild(this.select);

    const closeButton = htmlToElement("<a class='close'>&times</a>");
    popupContent.appendChild(closeButton);
    popupContent.append(document.createElement("br"));
    popupContent.append(document.createElement("br"));
    closeButton.addEventListener("click", () => this.hide());

    this.init();
  }

  async init() {
    let versionsUrl;
    if (globals.folder)
      versionsUrl = `versions/${globals.folder}/${globals.basename}-annotations.json`;
    else versionsUrl = `versions/${globals.basename}-annotations.json`;

    // Get the commits from the backend
    const versions = await fetch(versionsUrl)
      .then(checkResponseStatus)
      .then((response) => response.json());
    this.versions = versions;

    // TODO: I don't know if branches needs to be a list
    const branches = [...new Set(versions.map((ver) => ver.branch))];
    this.branches = branches;
    branches.forEach((branch) => {
      const option = document.createElement("option");
      option.text = branch;
      this.select.add(option);
    });

    if (globals.urlParams.has("commit")) {
      const commit = globals.urlParams.get("commit");
      this.currentVersion = versions.find((ver) => ver.commit === commit);
    } else {
      // if no commit is specified in the URL, the interface shows the latest commit,
      // either of any branch (if no branch is specified) or of the specified branch
      const branch = globals.urlParams.get("branch");
      if (branch === null) {
        this.currentVersion = versions[0];
      } else {
        this.currentVersion = versions.find((ver) => ver.branch === branch);
      }
    }
    this.currentBranchIndex = branches.indexOf(this.currentVersion.branch);

    const url = new URL(window.location);
    url.searchParams.delete("branch");
    versions.forEach((ver) => {
      // switch the URL to the version's commit
      url.searchParams.set("commit", ver.commit);
      ver.datetime = new Date(ver.datetime); // convert from ISO string to Date object
      ver.element = htmlToElement(`<div class="commit">
        <div class="message">
          <a href="${url.toString()}" class="commit-link">${ver.message}</a>
        </div>
        <span class="author-name">${ver.user}</span>
        ${getTimeAgoSpan(ver.datetime)}
      </div>`);
      this.popupContent.append(ver.element);
    });

    this.currentVersion.element.style.border = "3px solid #a4f05d";

    // Event listener for dropdown change
    this.select.addEventListener("change", () => this.updateEntries());
  }

  updateEntries() {
    const branch = this.select.value;
    this.versions.forEach((ver) => {
      ver.element.style.display = ver.branch === branch ? "block" : "none";
    });
  }

  /** Updates content and displays this popup. */
  show() {
    // default the dropdown to the current branch
    this.select.selectedIndex = this.currentBranchIndex;
    this.updateEntries();
    this.popup.style.display = "block";
  }

  /** Hides this popup. */
  hide() {
    this.popup.style.display = "none";
  }
};

export default CommitsPopup;
