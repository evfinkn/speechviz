import { htmlToElement } from "./util";

fetch("/clustered-faces")
    .then(res => {
        if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
        else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
        return res.json();  // return json from response
    })
    .then(fileList => { 
        const clusterFiles = fileList.cluster;
        
        if (clusterFiles?.length !== 0) {
            const fieldset = document.getElementById("file-selection");

            fieldset.append(htmlToElement("<strong>Clustered Faces</strong>"));  // header for video files
            clusterfolders.forEach(function (folderName){
                const div = htmlToElement(`<div><input type="radio" id="${folderName}cluster"" name="file-selection" value="${folderName}cluster"></input><label for="${folderName}cluster">${folderName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    // when radio button clicked, open that video file in viz
                    window.location.replace(`/clustered-faces?${user ? "user=" + user + "&" : ""}file=${this.value.replace('cluster', '')}`);
                });
                fieldset.append(div);
            });
        }
    })
    .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any

