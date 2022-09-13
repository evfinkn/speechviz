import { htmlToElement } from "./util";

var user;
// for some reason, setting variable in promise doesn't set it outside of promise,
// so need a function to call from promise to set it
const setUser = function (newUser) {
    user = newUser;
}

fetch("/user")
    .then(res => {
        if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
        else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
        return res.text();  // return json from response
    })
    .then(user => {
        if (user == "admin") {
            fetch("/users")
                .then(res => {
                    if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
                    else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
                    return res.json();  // return json from response
                })
                .then(users => {
                    setUser("admin");
                    const fieldset = document.getElementById("user-selection");
                    fieldset.hidden = false;
                    users.forEach(function (user) {
                        const div = htmlToElement(`<div><input type="radio" id="${user}" name="user-selection" value="${user}"></input><label for="${user}">${user}</label></div>`);
                        if (user == "admin") {
                            div.firstElementChild.checked = true;
                        }
                        div.firstElementChild.addEventListener("change", function () {
                            setUser(this.value);
                        });
                        fieldset.append(div);
                    });
                })
                .catch(error => { console.error("Error during fetch: ", error); });  // catch err thrown by res if any
        }
    })
    .catch(error => { console.error("Error during fetch: ", error); });  // catch err thrown by res if any

fetch("/filelist")
    .then(res => {
        if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
        else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
        return res.json();  // return json from response
    })
    // add radio buttons for each file
    .then(fileList => {  // fileList is data from the json
        const audiofiles = fileList.audio;
        const videofiles = fileList.video;
        const fieldset = document.getElementById("file-selection");

        if (audiofiles?.length !== 0) {
            fieldset.append(htmlToElement("<strong>Audio files</strong>"));

            audiofiles.forEach(function (fileName) {
                const div = htmlToElement(`<div><input type="radio" id="${fileName}" name="file-selection" value="${fileName}"></input><label for="${fileName}">${fileName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    window.location.replace(`/viz?${user ? "user=" + user + "&" : ""}file=${this.value}&type=audio`);
                });
                fieldset.append(div);
            });

            fieldset.append(document.createElement("br"));
        }

        if (videofiles?.length !== 0) {
            fieldset.append(htmlToElement("<strong>Video files</strong>"));

            videofiles.forEach(function (fileName) {
                const div = htmlToElement(`<div><input type="radio" id="${fileName}" name="file-selection" value="${fileName}"></input><label for="${fileName}">${fileName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    window.location.replace(`/viz?${user ? "user=" + user + "&" : ""}file=${this.value}&type=video`);
                });
                fieldset.append(div);
            });
        }
    })
    .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any