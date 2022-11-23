import { htmlToElement } from "./util";

fetch("/clustered-faces")
    .then(res => {
        if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
        else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); }  // not 200 is error
        return res.json();  // return json from response
    })
    .then(fileList => { 
        const clusterFiles = fileList.cluster;
        const fieldset = document.getElementById("file-selection");
        fieldset.append(htmlToElement("<strong>Clustered Faces</strong>"));
    })
    .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any

