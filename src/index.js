import { htmlToElement, checkResponseStatus } from "./util.js";

let user;
// for some reason, setting variable in promise doesn't set it outside of promise,
// so need a function to call from promise to set it. Very janky and I don't like it
// but don't know other way
/**
 * Set the user.
 * @param {string} newUser - The new user's name.
 */
const setUser = function (newUser) {
  user = newUser;
};

/**
 * Opens the main interface to visualize the specified file.
 * @param {string} fileName - The name of the file to open.
 * @param {string} type - The type of file to open. Either `"audio"` or `"video"`.
 * @param {?string} user - The name of the user opening the file.
 */
const openViz = function (fileName, type, user = null) {
  if (user !== null) {
    console.log(`/viz?user=${user}&file=${fileName}&type=${type}`);
    window.location.assign(`/viz?user=${user}&file=${fileName}&type=${type}`);
  } else {
    console.log(`/viz?file=${fileName}&type=${type}`);
    window.location.assign(`/viz?file=${fileName}&type=${type}`);
  }
};

/**
 * Creates a div containing a radio input and a label.
 * @param {string} id - The string to use for the input's id and value attributes
 *      and the label's text.
 * @param {string} name - The string to use for the input's name attribute.
 */
const createRadioDiv = function (id, name) {
  return htmlToElement(`<div>
        <input type="radio" id="${id}" name="${name}" value="${id}"></input>
        <label for="${id}">${id}</label>
    </div>`);
};

// Need to fetch user instead of using url param because otherwise anyone could
// just set themselves to admin by changing url param
fetch("/user") // fetch currently logged-in user
  .then(checkResponseStatus)
  .then((response) => response.text())
  .then((user) => {
    // admin is able to view all users' annotations
    // so make radio buttons for selecting which user
    if (user == "admin") {
      fetch("/users") // fetch list of all users
        .then(checkResponseStatus)
        .then((res) => res.json())
        // add radio buttons for each user
        .then((users) => {
          // users is array of usernames
          setUser("admin");
          const usersAccordion = document.getElementById("user-selection-acc");
          const fieldset = document.getElementById("user-selection");
          usersAccordion.hidden = false;
          users.forEach(function (user) {
            const div = createRadioDiv(user, "user-selection");
            div.firstElementChild.addEventListener("change", function () {
              setUser(this.value);
            });
            // default user for admin is admin, so check admin radio button
            if (user == "admin") {
              div.firstElementChild.checked = true;
            }
            fieldset.append(div);
          });
        })
        // catch error if fetch unsuccessful
        .catch((error) => {
          console.error("Error during fetch: ", error);
        });
    }
  })
  // catch error if fetch unsuccessful
  .catch((error) => {
    console.error("Error during fetch: ", error);
  });

fetch("/filelist")
  .then(checkResponseStatus)
  .then((response) => response.json())
  // add radio buttons for each file
  .then((fileList) => {
    // object with arrays for audio filenames and video filenames
    const audiofiles = fileList.audio;
    const videofiles = fileList.video;
    const clusterfolders = fileList.cluster;
    const audioFieldset = document.getElementById("audio-selection");
    const videoFieldset = document.getElementById("video-selection");
    const faceFieldset = document.getElementById("face-selection");

    if (audiofiles?.length !== 0) {
      audiofiles.forEach(function (fileName) {
        // add radio buttons for each audio file
        const div = createRadioDiv(fileName, "audio-selection");
        div.firstElementChild.addEventListener("change", function () {
          // uncheck manually because otherwise after using back button to go
          // back to this page, the radio button will still be checked
          this.checked = false;
          if (!this.id.includes(".")) {
            // no extension means this is a folder
            // TODO: if they don't have a run0 this breaks
            openViz("run0.wav", `audio&folder=${this.value}`, user);
          } else {
            openViz(this.value, "audio", user);
          }
        });
        audioFieldset.append(div);
      });

      // add separation between audio and video file sections
    }

    if (videofiles?.length !== 0) {
      // header for video files
      videofiles.forEach(function (fileName) {
        // add radio buttons for each video file
        const div = createRadioDiv(fileName, "video-selection");
        div.firstElementChild.addEventListener("change", function () {
          this.checked = false;
          openViz(this.value, "video", user);
        });
        videoFieldset.append(div);
      });

      // add separation between video and clustered sections
    }

    if (clusterfolders?.length !== 0) {
      // header for cluster folders
      clusterfolders.forEach(function (folderName) {
        // folderName matches corresponding video fileName, so give it a different id
        const div = createRadioDiv(
          folderName + " Clusters",
          "cluster-selection"
        );
        div.firstElementChild.addEventListener("change", function () {
          this.checked = false;
          // when radio button clicked, show each cluster folder to choose which to view
          // remove its different id, go to correct folder
          window.location.assign(
            `/clustered-faces?${user ? "user=" + user + "&" : ""}` +
              `dir=${this.value.replace(" Clusters", "")}` +
              `&inFaceFolder=false`
          );
        });
        faceFieldset.append(div);
      });
    }
    var acc = document.getElementsByClassName("accordion");
    var i;

    for (i = 0; i < acc.length; i++) {
      acc[i].addEventListener("click", function () {
        this.classList.toggle("accordionactive");
        var panel = this.nextElementSibling;
        if (panel.style.display === "grid") {
          panel.style.display = "none";
        } else {
          panel.style.display = "grid";
        }
      });
    }
  })
  // catch err thrown by res if any
  .catch((error) => {
    console.error("Error during fetch: ", error);
  });
