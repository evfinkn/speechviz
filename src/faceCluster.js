import { htmlToElement } from "./util";

fetch("/clustered-files")
    .then(res => {
        if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
        else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); } 
        return res.json();  // return json from response
    })
    .then(fileList => { 
        const clusterfolders = fileList.cluster;
        const fieldset = document.getElementById("file-selection");
        
        if (clusterfolders?.length !== 0 && !fileList.inFaceFolder){
            clusterfolders.forEach(function (folderName){
                const div = htmlToElement(`<div><input type="radio" id="${folderName}cluster` 
                + ` name="file-selection" value="${folderName}cluster"></input><label for="`
                + `${folderName}cluster">${folderName}</label></div>`);
                div.firstElementChild.addEventListener("change", function () {
                    // when radio button clicked, open that video file in viz
                    window.location.replace(`/clustered-faces?faceFolder=`
                                            + `${this.value.replace('cluster', '')}`
                                            + `&inFaceFolder=true`);
                });
                fieldset.append(div);
            });
        }
    })
    .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any

