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
    .then(fileList => {
        const fieldset = document.getElementById("file-selection");
        fileList.forEach(function (fileName) {  // fileList is data from the json
            const div = document.createElement("div");
            div.innerHTML = `<input type="radio" id="${fileName}" name="file-selection" value="${fileName}"></input><label for="${fileName}">${fileName}</label>`;
            div.firstElementChild.addEventListener("change", function () {
                window.location.replace(`/viz?audiofile=${this.value}${user ? "&user=" + user : ""}`);
            });
            fieldset.append(div);
        });
    })
    .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any