const getRandomColor = function () {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

const htmlToElement = function (html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild;
}

// property is the segment property to sort by, i.e. 'startTime' or 'labelText'
const compareProperty = function (obj1, obj2, property) {
    if (obj1[property] > obj2[property]) { return 1; }
    if (obj1[property] < obj2[property]) { return -1; }
    return 0;
}

const propertiesEqual = function (obj1, obj2, properties) {
    for (let prop of properties) {
        if (obj1[prop] != obj2[prop]) { return false; }
    }
    return true;
}


export { getRandomColor, htmlToElement, compareProperty, propertiesEqual };
