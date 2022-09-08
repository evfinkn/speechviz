/**
 * Generates a random color
 * @returns {string} A hex string of the form "#RRGGBB"
 */
const getRandomColor = function () {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Generates an HTMLElement from a string containing HTML
 * @param {string} html - String containing HTML
 * @returns {Element|null} An HTMLElement
 */
const htmlToElement = function (html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild;
}

/**
 * Compares two objects by one of their properties
 * @param {Object} obj1 - Object to compare
 * @param {Object} obj2 - Object to compare
 * @param {string} property - Name of property to compare by
 * @returns {number} A negative number if obj1 is less than obj2, a positive number if obj1 is greater than obj2, and 0 if obj1 equals obj2
 */
const compareProperty = function (obj1, obj2, property) {
    if (obj1[property] < obj2[property]) { return -1; }
    if (obj1[property] > obj2[property]) { return 1; }
    return 0;
}

/**
 * Sorts an array in place by a property of its elements
 * @param {Object[]} array - Array to sort
 * @param {string} property - Name of property to sort by
 * @param {boolean} [reverse=false] - If false, sorts array in ascending order. Otherwise, sorts descending
 * @returns {Object[]} The reference to the original array, now sorted
 */
const sortByProp = function (array, property, reverse = false) {
    reverse = reverse ? -1 : 1;
    array.sort((obj1, obj2) => compareProperty(obj1, obj2, property) * reverse);
    return array;
}

/**
 * Tests if the properties of two objects are equal
 * @param {Object} obj1 - Object to compare
 * @param {Object} obj2 - Object to compare
 * @param {string[]} properties - List of properties to compare by
 * @returns {boolean} True if all of the given properties of the objects are equal. False otherwise
 */
const propertiesEqual = function (obj1, obj2, properties) {
    for (let prop of properties) {
        if (obj1[prop] != obj2[prop]) { return false; }
    }
    return true;
}

/**
 * Toggles a button, making it clickable and black or unclickable and gray
 * @param {HTMLElement} button - Button to toggle
 * @param {boolean=} force - 
 */
const toggleButton = function (button, force = null) {
    const on = force != null ? force : !button.style.pointerEvents == "auto";
    button.style.pointerEvents = on ? "auto" : "none";
    const svg = button.firstElementChild;
    svg.style.stroke = on ? "black" : "gray";
    if (svg.getAttribute("fill") != "none") { svg.style.fill = on ? "black" : "gray"; }
}

/**
 * Sums the elements of an array, optionally calling a function on each element
 * @param {number[]} array - Array to calculate sum of
 * @param {function(number, ...any):number=} func - Function to call on each element
 * @param  {...any} args - Extra arguments to pass to `func`
 * @returns {number} The sum of the elements of the array
 */
const arraySum = function (array, func = null, ...args) {
    if (func) { return array.reduce((sum, curNum) => sum + func(curNum, ...args), 0); }
    else { return array.reduce((sum, curNum) => sum + curNum, 0); }
}

/**
 * Calculates the mean of an array, optionally calling a function on each element
 * @param {number[]} array - Array to calculate mean of
 * @param {function(number, ...any):number=} func - Function to call on each element
 * @param  {...any} args - Extra arguments to pass to `func`
 * @returns {number} The mean of the elements of the array
 */
const arrayMean = function (array, func = null, ...args) {
    return arraySum(array, func, ...args) / array.length;
}

/**
 * Construct a new object by setting each key to its value run through a function
 * @param {Object} obj - The original object
 * @param {function(any, ...any):any} func - Function to call on each value
 * @param  {...any} args - Extra arguments to pass to `func`
 * @returns {Object} The new object
 */
const objectMap = function (obj, func, ...args) {
    const mapped = {};
    for (const [key, value] of Object.entries(obj)) {
        mapped[key] = func(value, ...args);
    }
    return mapped;
}

export { getRandomColor, htmlToElement, compareProperty, sortByProp, propertiesEqual, toggleButton, arraySum, arrayMean, objectMap };