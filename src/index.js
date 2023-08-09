import { html, checkResponseStatus } from "./util.js";

/**
 * Opens the main interface to visualize the specified file.
 * @param {string} fileName - The name of the file / folder to open.
 * @param {string} type - The type of file to open. Either `"audio"` or `"video"`.
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
 * Creates a div containing a radio input and a label.
 * @param {string} id - The string to use for the input's id and value attributes
 *      and the label's text.
 * @param {string} name - The string to use for the input's name attribute.
 */
const createRadioDiv = function (id, name) {
  return html`<div>
        <input type="radio" id="${id}" name="${name}" value="${id}"></input>
        <label for="${id}">${id}</label>
    </div>`;
};

const initAudioSelection = async () => {
  const audioFieldset = document.getElementById("audio-selection");
  const response = await fetch("/audio");
  checkResponseStatus(response);
  const audioFiles = await response.json();
  audioFiles.forEach((audioFile) => {
    const div = createRadioDiv(audioFile, "audio-selection");
    div.firstElementChild.addEventListener("change", function () {
      // uncheck manually because otherwise after using back button to go
      // back to this page, the radio button will still be checked
      this.checked = false;
      openViz(this.value, "audio");
    });
    audioFieldset.append(div);
  });
};

const initVideoSelection = async () => {
  const videoFieldset = document.getElementById("video-selection");
  const response = await fetch("/video");
  checkResponseStatus(response);
  const videoFiles = await response.json();
  videoFiles.forEach((videoFile) => {
    const div = createRadioDiv(videoFile, "video-selection");
    div.firstElementChild.addEventListener("change", function () {
      this.checked = false;
      openViz(this.value, "video");
    });
    videoFieldset.append(div);
  });
};

const initFaceSelection = async () => {
  const faceFieldset = document.getElementById("face-selection");
  const response = await fetch("/faceClusters");
  checkResponseStatus(response);
  const faceFolders = await response.json();
  faceFolders.forEach((faceFolder) => {
    // faceFolder matches corresponding video file name, so give it a different id
    const div = createRadioDiv(faceFolder + " Clusters", "face-selection");
    div.firstElementChild.addEventListener("change", function () {
      this.checked = false;
      // when radio button clicked, show each cluster folder to choose which to view
      // remove its different id, go to correct folder
      window.location.assign(
        `/clustered-faces?` +
          `dir=${this.value.replace(" Clusters", "")}` +
          `&inFaceFolder=false`
      );
    });
    faceFieldset.append(div);
  });
};

initAudioSelection();
initVideoSelection();
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
