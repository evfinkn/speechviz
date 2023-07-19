import { htmlToElement } from "./util.js";

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
    // Example data for commits
    const commits = [
      {
        id: 1,
        message: "Initial commit",
        author: "John Doe",
        created: new Date("2023-06-01T10:30:00"),
        branch: "Head",
      },
      {
        id: 2,
        message: "Added feature A",
        author: "Jane Smith",
        created: new Date("2023-06-02T14:45:00"),
        branch: "Head",
      },
      {
        id: 3,
        message: "Fixed bug in feature B",
        author: "John Doe",
        created: new Date("2023-06-03T09:15:00"),
        branch: "Head",
      },
      {
        id: 4,
        message: "Refactored code",
        author: "Jane Smith",
        created: new Date("2023-06-04T16:20:00"),
        branch: "Head",
      },
      {
        id: 5,
        message: "Updated documentation",
        author: "John Doe",
        created: new Date("2023-06-05T11:10:00"),
        branch: "Head",
      },
      {
        id: 6,
        message: "Implemented feature C",
        author: "Jane Smith",
        created: new Date("2023-06-06T13:25:00"),
        branch: "Head",
      },
      {
        id: 7,
        message: "Initial commit",
        author: "John Doe",
        created: new Date("2023-06-01T10:30:00"),
        branch: "Test",
      },
      {
        id: 8,
        message: "Initial commit",
        author: "John Doe",
        created: new Date("2023-06-01T10:30:00"),
        branch: "News",
      },
    ];

    // Sort commits in reverse chronological order
    commits.sort(function (a, b) {
      return b.created - a.created;
    });

    this.popup = htmlToElement("<div class='popup'></div>");
    document.body.append(this.popup);

    const popupContent = htmlToElement("<div class='popup-content'></div>");
    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);

    // Create the branch dropdown
    var select = document.createElement("select");
    select.style.float = "left"; // Float the dropdown to the left

    // In the future populate this with branches from back-end,
    // then select most recent branch as the default (the 0 index)
    var options = ["Head", "Test", "News"];
    for (var i = 0; i < options.length; i++) {
      var option = document.createElement("option");
      option.text = options[i];
      select.add(option);
    }

    popupContent.appendChild(select);
    const closeButton = htmlToElement("<a class='close'>&times</a>");
    popupContent.appendChild(closeButton);
    popupContent.append(document.createElement("br"));
    popupContent.append(document.createElement("br"));
    closeButton.addEventListener("click", () => this.hide());

    // populate with default of dropdown initially
    if (select[0])
      commits
        .filter(function (commit) {
          return commit.branch === select[0].value;
        })
        .forEach(function (commit) {
          const commitElement = htmlToElement(`
              <div class="commit">
              <div class="message"><a href="https://google.com" class="commit-link">${
                commit.message
              }</a></div>
              <span class="author-name">${
                commit.author
              }</span> <span class="time-ago">(${commit.created
            .toDateString()
            .split(" ")
            .slice(1)
            .join(" ")})</span>
              </div>
            `);

          // Append commit to commit history
          popupContent.appendChild(commitElement);
        });

    // Event listener for dropdown change
    select.addEventListener("change", function () {
      // Get the selected branch
      var selectedBranch = this.value;

      // Remove all commit elements from popupContent
      var commitElements = popupContent.querySelectorAll(".commit");
      commitElements.forEach(function (element) {
        element.remove();
      });

      // Filter and create commit elements for the selected branch
      commits
        .filter(function (commit) {
          return commit.branch === selectedBranch;
        })
        .forEach(function (commit) {
          const commitElement = htmlToElement(`
            <div class="commit">
            <div class="message"><a href="https://google.com" class="commit-link">${
              commit.message
            }</a></div>
            <span class="author-name">${
              commit.author
            }</span> <span class="time-ago">(${commit.created
            .toDateString()
            .split(" ")
            .slice(1)
            .join(" ")})</span>
            </div>
          `);

          // Append commit to commit history
          popupContent.appendChild(commitElement);
        });
    });
  }

  /** Updates content and displays this popup. */
  show() {
    this.popup.style.display = "block";
  }

  /** Hides this popup. */
  hide() {
    this.popup.style.display = "none";
  }
};

export default CommitsPopup;
