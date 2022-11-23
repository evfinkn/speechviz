import { htmlToElement } from "./util";
const fs = require("fs");

let user;
// for some reason, setting variable in promise doesn't set it outside of promise,
// so need a function to call from promise to set it. Very janky and I don't like it
// but don't know other way
const setUser = function (newUser) {
    user = newUser;
}

// Need to fetch user instead of using url param because otherwise anyone could
// just set themselves to admin by changing url param
fetch("/user")  // fetch currently logged-in user
    .then(res => {
        if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
        else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
        return res.text();  // return text from response
    })
    .then(user => {
        // admin is able to view all users' annotations, so make radio buttons for selecting which user
        if (user == "admin") {
            fetch("/users")  // fetch list of all users
                .then(res => {
                    if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
                    else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
                    return res.json();  // return json from response
                })
                // add radio buttons for each user
                .then(users => {  // users is array of usernames
                    setUser("admin");
                    const fieldset = document.getElementById("user-selection");
                    fieldset.hidden = false;
                    users.forEach(function (user) {
                        const div = htmlToElement(`<div><input type="radio" id="${user}" name="user-selection" value="${user}"></input><label for="${user}">${user}</label></div>`);
                        if (user == "admin") {  // default user for admin is admin, so check admin radio button
                            div.firstElementChild.checked = true;
                        }
                        div.firstElementChild.addEventListener("change", function () {
                            setUser(this.value);  // see top for reasoning behind function
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
    .then(fileList => {  // fileList is object with arrays for audio filenames and video filenames
        const audiofiles = fileList.audio;
        const videofiles = fileList.video;
        const clusterfolders = fileList.cluster;
        const fieldset = document.getElementById("file-selection");

        if (audiofiles?.length !== 0) {
            fieldset.append(htmlToElement("<strong>Audio files</strong>"));  // header for audio files

            audiofiles.forEach(function (fileName) {  // add radio buttons for each audio file
                const div = htmlToElement(`<div><input type="radio" id="${fileName}" name="file-selection" value="${fileName}"></input><label for="${fileName}">${fileName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    // when radio button clicked, open that audio file in viz
                    window.location.replace(`/viz?${user ? "user=" + user + "&" : ""}file=${this.value}&type=audio`);
                });
                fieldset.append(div);
            });

            fieldset.append(document.createElement("br"));  // add separation between audio and video file sections
        }

        if (videofiles?.length !== 0) {
            fieldset.append(htmlToElement("<strong>Video files</strong>"));  // header for video files

            videofiles.forEach(function (fileName) {  // add radio buttons for each video file
                const div = htmlToElement(`<div><input type="radio" id="${fileName}" name="file-selection" value="${fileName}"></input><label for="${fileName}">${fileName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    // when radio button clicked, open that video file in viz
                    window.location.replace(`/viz?${user ? "user=" + user + "&" : ""}file=${this.value}&type=video`);
                });
                fieldset.append(div);
            });
        }
        if (clusterfolders?.length !== 0){
            fieldset.append(htmlToElement("<strong>Clustered Faces</strong>"));  // header for video files
            clusterfolders.forEach(function (folderName){
                const div = htmlToElement(`<div><input type="radio" id="${folderName}cluster"" name="file-selection" value="${folderName}cluster"></input><label for="${folderName}cluster">${folderName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    // when radio button clicked, open that video file in viz
                    //const faces = fs.readdirSync("../data/faceClusters" + this.value.replace("cluster", "")).filter(fileName => !exclude.has(fileName));

                    console.log(fs.readdirSync(""));
                    //faces.forEach(function faceFolders){
                        //console.log(faceFolders);
                    //});
                    window.location.replace(`/clustered-faces?${user ? "user=" + user + "&" : ""}folder=${this.value.replace('cluster', '')}&faces=`);
                });
                fieldset.append(div);
            });
        }
    })
    .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any
