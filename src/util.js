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

const segProperties = ["startTime", "endTime", "editable", "color", "labelText", "id", "path", "treeText", "removable"];
const copySegment = function(seg, exclude = []) {
    const copied = {};
    segProperties.forEach(function (prop) {
        if (!exclude.includes(prop)) { copied[prop] = seg[prop]; }
    })
    return copied;
}

const toggleButton = function(button, force = null) {
    const on = force != null ? force : !button.style.pointerEvents == "auto";
    button.style.pointerEvents = on ? "auto" : "none";
    const svg = button.firstElementChild;
    svg.style.stroke = on ? "black" : "gray";
    if (svg.getAttribute("fill") != "none") { svg.style.fill = on ? "black" : "gray"; }
}

export { getRandomColor, htmlToElement, compareProperty, propertiesEqual, copySegment, toggleButton };

