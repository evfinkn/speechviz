// fetch list of audio files in public/audio
fetch("/filelist")
  .then(res => {
    if (!res.ok) { throw new Error('Network response was not OK'); }  // Network error
    else if (res.status != 200) { throw new Error(`${res.status} ${res.statusText}`); } // 200 is 
    return res.json();  // return json from response
  })
  // add radio buttons for each file
  .then(fileList => fileList.forEach(function (fileName) {  // fileList is data from the json
    const div = document.createElement("div");
    div.innerHTML = `<input type="radio" id="${fileName}" name="file-selection" value="${fileName}"></input><label for="${fileName}">${fileName}</label>`;
    div.firstChild.addEventListener("change", function () { window.location.replace(`/viz?audiofile=${this.value}`); });
    filesFieldset.append(div);
  }))
  .catch(error => { console.error('Error during fetch: ', error); });  // catch err thrown by res if any
