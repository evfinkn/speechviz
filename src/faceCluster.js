import { htmlToElement } from "./util";

fetch("/clustered-files")
    .then(res => {
        if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
        else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
        return res.json();  // return json from response
    })
    .then(fileList => { 
        console.log(fileList);
        const clusterfolders = fileList.cluster;
        console.log(clusterfolders);
        const fieldset = document.getElementById("file-selection");
        fieldset.append(htmlToElement("<strong>Clustered Faces</strong>"));

        if (clusterfolders?.length !== 0){
            fieldset.append(htmlToElement("<strong>Clustered Faces</strong>"));  // header for video files
            clusterfolders.forEach(function (folderName){
                const div = htmlToElement(`<div><input type="radio" id="${folderName}cluster"" name="file-selection" value="${folderName}cluster"></input><label for="${folderName}cluster">${folderName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    // when radio button clicked, open that video file in viz
                    console.log(this.value);
                    window.location.replace(`/clustered-faces?${user ? "user=" + user + "&" : ""}dir=${this.value.replace('cluster', '')}&inFaceFolder=true`);
                });
                fieldset.append(div);
            });
        }
    })
    .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any

