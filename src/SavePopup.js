import { htmlToElement } from "./util.js";
import { save } from "./init.js";

/** The popup containing extra settings for configuring the interface. */
const SavePopup = class SavePopup {
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
    const select = document.createElement("select");
    select.style.float = "left"; // Float the dropdown to the left

    // In the future populate this with branches from back-end,
    // then select most recent branch as the default (the 0 index)
    const options = ["Head", "Test", "News"];
    for (let i = 0; i < options.length; i++) {
      const option = document.createElement("option");
      option.text = options[i];
      select.add(option);
    }

    popupContent.appendChild(select);
    const closeButton = htmlToElement("<a class='close'>&times</a>");
    popupContent.appendChild(closeButton);
    popupContent.append(document.createElement("br"));
    popupContent.append(document.createElement("br"));
    closeButton.addEventListener("click", () => this.hide());

    const newBranch = htmlToElement(
      "<label><input type='checkbox'> Save to new branch</label>"
    );
    const checkbox = newBranch.querySelector("input[type='checkbox']");
    popupContent.appendChild(newBranch);

    popupContent.append(document.createElement("br"));

    // new branch name info
    const newBranchLabel = document.createElement("Label");
    newBranchLabel.innerText = "New Branch Name:";
    newBranchLabel.style.display = "none";
    popupContent.append(newBranchLabel);
    popupContent.append(document.createElement("br"));

    const inputElement = document.createElement("input");
    inputElement.type = "text";
    popupContent.append(inputElement);
    inputElement.style.display = "none";
    popupContent.append(document.createElement("br"));

    // commit message info
    const commitLabel = document.createElement("Label");
    commitLabel.innerText = "Commit Message:";
    popupContent.append(commitLabel);
    popupContent.append(document.createElement("br"));

    const commitMessage = document.createElement("input");
    commitMessage.type = "text";
    popupContent.append(commitMessage);

    popupContent.append(document.createElement("br"));
    popupContent.append(document.createElement("br"));
    const buttonElement = htmlToElement("<button>" + "Save" + "</button>");
    popupContent.append(buttonElement);

    checkbox.addEventListener("change", function () {
      if (this.checked) {
        // hide the dropdown, don't need it
        select.style.display = "none";
        inputElement.style.display = "inline-block";
        newBranchLabel.style.display = "inline-block";
      } else {
        select.style.display = "inline-block";
        inputElement.style.display = "none";
        newBranchLabel.style.display = "none";
      }
    });

    buttonElement.addEventListener("click", function () {
      save();
      if (checkbox.checked) {
        console.log("Saving to a new branch:", inputElement.value);
      } else {
        console.log("Saving to branch:", select.value);
      }
      console.log("Commit message given: ", commitMessage.value);
    });

    // Event listener for dropdown change
    // select.addEventListener("change", function () {
    //   // Get the selected branch
    //   var selectedBranch = this.value;

    //   // Remove all commit elements from popupContent
    //   var commitElements = popupContent.querySelectorAll(".commit");
    //   commitElements.forEach(function (element) {
    //     element.remove();
    //   });

    //   // Filter and create commit elements for the selected branch
    //   commits
    //     .filter(function (commit) {
    //       return commit.branch === selectedBranch;
    //     })
    //     .forEach(function (commit) {
    //       const commitElement = htmlToElement(`
    //         <div class="commit">
    //         <div class="message"><a href="https://google.com" class="commit-link">${
    //           commit.message
    //         }</a></div>
    //         <span class="author-name">${
    //           commit.author
    //         }</span> <span class="time-ago">(${getTimeAgo(
    //         commit.created
    //       )})</span>
    //         </div>
    //       `);

    //       // Append commit to commit history
    //       popupContent.appendChild(commitElement);
    //     });
    // });
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

export default SavePopup;
