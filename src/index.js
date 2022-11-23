import { htmlToElement, checkResponseStatus } from "./util";

let user;
// for some reason, setting variable in promise doesn't set it outside of promise,
// so need a function to call from promise to set it. Very janky and I don't like it
// but don't know other way
/**
 * Set the user.
 * @param {string} newUser - The new user's name.
 */
const setUser = function (newUser) { user = newUser; }

/**
 * Opens the main interface to visualize the specified file.
 * @param {string} fileName - The name of the file to open.
 * @param {string} type - The type of file to open. Either `"audio"` or `"video"`.
 * @param {?string} user - The name of the user opening the file.
 */
const openViz = function (fileName, type, user = null) {
    if (user !== null) {
        window.location.replace(`/viz?user=${user}file=${fileName}&type=${type}`);
    }
    else {
        window.location.replace(`/viz?file=${fileName}&type=${type}`);
    }
}

/**
 * Creates a div containing a radio input and a label.
 * @param {string} id - The string to use for the input's id and value attributes and the label's
 *      text.
 * @param {string} name - The string to use for the input's name attribute.
 */
const createRadioDiv = function (id, name) {
    return htmlToElement(`<div>
        <input type="radio" id="${id}" name="${name}" value="${id}"></input>
        <label for="${id}">${id}</label>
    </div>`);
}

// Need to fetch user instead of using url param because otherwise anyone could
// just set themselves to admin by changing url param
fetch("/user")  // fetch currently logged-in user
    .then(checkResponseStatus)
    .then(response => response.text())
    .then(user => {
        // admin is able to view all users' annotations
        // so make radio buttons for selecting which user
        if (user == "admin") {
            fetch("/users")  // fetch list of all users
                .then(checkResponseStatus)
                .then(res => res.json())
                // add radio buttons for each user
                .then(users => {  // users is array of usernames
                    setUser("admin");
                    const fieldset = document.getElementById("user-selection");
                    fieldset.hidden = false;
                    users.forEach(function (user) {
                        const div = createRadioDiv(user, "user-selection");
                        div.firstElementChild.addEventListener("change", function () {
                            setUser(this.value);
                        });
                        // default user for admin is admin, so check admin radio button
                        if (user == "admin") { div.firstElementChild.checked = true; }
                        fieldset.append(div);
                    });
                })
                // catch error if fetch unsuccessful
                .catch(error => { console.error("Error during fetch: ", error); });
        }
    })
    // catch error if fetch unsuccessful
    .catch(error => { console.error("Error during fetch: ", error); });

fetch("/filelist")
    .then(checkResponseStatus)
    .then(response => response.json())
    // add radio buttons for each file
    .then(fileList => {  // object with arrays for audio filenames and video filenames
        const audiofiles = fileList.audio;
        const videofiles = fileList.video;
        const fieldset = document.getElementById("file-selection");

        if (audiofiles?.length !== 0) {
            fieldset.append(htmlToElement("<strong>Audio files</strong>"));  // header

            audiofiles.forEach(function (fileName) {  // add radio buttons for each audio file
                const div = createRadioDiv(fileName, "file-selection");
                div.firstElementChild.addEventListener("change", function () {
                    openViz(this.value, "audio", user);
                });
                fieldset.append(div);
            });

            // add separation between audio and video file sections
            fieldset.append(document.createElement("br"));
        }

        if (videofiles?.length !== 0) {
            fieldset.append(htmlToElement("<strong>Video files</strong>"));  // header

            videofiles.forEach(function (fileName) {  // add radio buttons for each video file
                const div = createRadioDiv(fileName, "file-selection");
                div.firstElementChild.addEventListener("change", function () {
                    openViz(this.value, "video", user);
                });
                fieldset.append(div);
            });
        }
    })
    // catch error if fetch unsuccessful
    .catch(error => { console.error('Error during fetch: ', error); });