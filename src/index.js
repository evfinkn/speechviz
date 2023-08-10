import { html, checkResponseStatus } from "./util.js";

/**
 * Opens the main interface to visualize the specified file.
 * @param {string} fileName - The name of the file / folder to open.
 * @param {("audio"|"video"|"views")} type - The type of file to open.
 */
const openViz = function (fileName, type) {
  let url = `/viz?type=${type}`;
  if (!fileName.includes(".")) {
    // no extension means this is a folder
    url += `&folder=${fileName}`;
  } else {
    url += `&file=${fileName}`;
  }
  window.location.assign(url);
};

/**
 * Creates a label with a radio input as its first child.
 * @param {string} id - The string to use for the input's id.
 * @param {string} name - The string to use for the input's name attribute.
 * @param {string} [value=id] - The string to use for the input's value attribute and
 *    the label's text.
 * @returns {!HTMLLabelElement} The created label element containing the radio input.
 */
const createRadio = function (id, name, value = id) {
  return html`<label>
        <input type="radio" id="${id}" name="${name}" value="${value}"></input>
        ${value}
    </label>`;
};

const initAudioSelection = async () => {
  const audioFieldset = document.getElementById("audio-selection");
  const response = await fetch("/audio");
  checkResponseStatus(response);
  const audioFiles = await response.json();
  audioFiles.forEach((audioFile) => {
    const label = createRadio(audioFile, "audio-selection");
    label.firstElementChild.addEventListener("change", function () {
      // uncheck manually because otherwise after using back button to go
      // back to this page, the radio button will still be checked
      this.checked = false;
      openViz(this.value, "audio");
    });
    audioFieldset.append(label);
  });
};

const initVideoSelection = async () => {
  const videoFieldset = document.getElementById("video-selection");
  const response = await fetch("/video");
  checkResponseStatus(response);
  const videoFiles = await response.json();
  videoFiles.forEach((videoFile) => {
    const label = createRadio(videoFile, "video-selection");
    label.firstElementChild.addEventListener("change", function () {
      this.checked = false;
      openViz(this.value, "video");
    });
    videoFieldset.append(label);
  });
};

const initViewSelection = async () => {
  const viewFieldset = document.getElementById("view-selection");
  const response = await fetch("/views");
  checkResponseStatus(response);
  const viewFiles = await response.json();
  viewFiles
    .filter((viewFile) => !viewFile.endsWith("-times.csv"))
    .forEach((viewFile) => {
      // viewFile matches corresponding audio folder name, so give it a different id
      const label = createRadio(`${viewFile}-view`, "view-selection", viewFile);
      label.firstElementChild.addEventListener("change", function () {
        this.checked = false;
        openViz(this.value, "views");
      });
      viewFieldset.append(label);
    });
};

const initFaceSelection = async () => {
  const faceFieldset = document.getElementById("face-selection");
  const response = await fetch("/faceClusters");
  checkResponseStatus(response);
  const faceFolders = await response.json();
  faceFolders.forEach((faceFolder) => {
    // faceFolder matches corresponding video file name, so give it a different id
    const label = createRadio(
      `${faceFolder}-cluster`,
      "face-selection",
      faceFolder
    );
    label.firstElementChild.addEventListener("change", function () {
      this.checked = false;
      // when radio button clicked, show each cluster folder to choose which to view
      // remove its different id, go to correct folder
      window.location.assign(
        `/clustered-faces?dir=${this.value}&inFaceFolder=false`
      );
    });
    faceFieldset.append(label);
  });
};

initAudioSelection();
initVideoSelection();
initViewSelection();
initFaceSelection();

const accordians = document.getElementsByClassName("accordion");
Array.from(accordians).forEach((accordian) => {
  accordian.addEventListener("click", function () {
    this.classList.toggle("accordionactive");
    const panel = this.nextElementSibling;
    if (panel.style.display === "grid") {
      panel.style.display = "none";
    } else {
      panel.style.display = "grid";
    }
  });
});
