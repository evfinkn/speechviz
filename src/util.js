/**
 * Generates a random color.
 * @returns {!Color} The randomly generated color.
 */
const getRandomColor = function () {
    // Get a random number between 0 and 256, convert it to a hex string, and pad with 0
    const r = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    const g = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    const b = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
}

/**
 * Generates an HTMLElement from a string containing HTML.
 * @param {string} html - The `string` containing the HTML.
 * @returns {?Element} The `Element` represented by `html`.
 */
const htmlToElement = function (html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild;
}

/**
 * Compares two `Objects` by one of their properties.
 * Uses less than and greater than to compare the properties.
 * @param {!Object.<string, any>} obj1 - An object to compare.
 * @param {!Object.<string, any>} obj2 - An object to compare.
 * @param {string} property - The name of the property to compare the objects by.
 * @returns {number} A negative number if `obj1` is less than / before `obj2`, a positive number if
 *      `obj1` is greater than / after `obj2`, or `0` if `obj1` equals `obj2`.
 */
const compareProperty = function (obj1, obj2, property) {
    if (obj1[property] < obj2[property]) { return -1; }
    if (obj1[property] > obj2[property]) { return 1; }
    return 0;
}

/**
 * Sorts an array of `Object`s in place by a property of its elements.
 * @param {!Array.<Object.<string, any>>} array - The array of objects to sort.
 * @param {string} property - The name of the property to sort by.
 * @param {boolean} [reverse=false] - If `false`, the array is sorted in ascending order.
 *      Otherwise, the array is sorted in descending order.
 * @returns {!Array.<Object.<string, any>>} The reference to the original array, now sorted.
 */
const sortByProp = function (array, property, reverse = false) {
    reverse = reverse ? -1 : 1;
    array.sort((obj1, obj2) => compareProperty(obj1, obj2, property) * reverse);
    return array;
}

/**
 * Tests if the given properties of two `Object`s are equal.
 * @param {!Object.<string, any>} obj1 - An object to compare.
 * @param {!Object.<string, any>} obj2 - An object to compare.
 * @param {!Array.<string>} properties - An array of the names of the properties to compare by.
 * @returns {boolean} `true` if all of the given properties of the objects are equal.
 *      Otherwise, `false`.
 */
const propertiesEqual = function (obj1, obj2, properties) {
    for (let prop of properties) {
        if (obj1[prop] != obj2[prop]) { return false; }
    }
    return true;
}

/**
 * Toggles a button on /off.
 * Specifically, makes a button clickable / unclickable and colors it black / gray.
 * @param {!Element} button - The button element to toggle.
 * @param {boolean=} force - If unspecified, `button` is always toggled. Otherwise, `button`
 *      is only toggled if its current state isn't equal to `force`.
 * @returns {boolean} A `boolean` indiciating if any toggling was done. In other words, when
 *      `force == null`, returns `true`. Otherwise, returns `force !== clickable`.
 */
const toggleButton = function (button, force = null) {
    const currentlyOn = button.classList.contains("button-on");
    if ((force == true && currentlyOn) || (force == false && !currentlyOn)) {
        return false;
    }
    const on = force == null ? !currentlyOn : force;
    button.classList.toggle("button-on", on);
    button.classList.toggle("button-off", !on);
    return true;
}

/**
 * Sums the elements of an array, optionally calling a function on each element before summing.
 * @param {!Array.<number>} array - The array of `numbers` to sum.
 * @param {?function(number, ...any):number=} func - A `function` to call on each element.
 * @param  {...any} args - Extra arguments to pass to `func`. These are passed after the current
 *      element in the array.
 * @returns {number} The sum of the elements of the array.
 */
const arraySum = function (array, func = null, ...args) {
    if (func) { return array.reduce((sum, curNum) => sum + func(curNum, ...args), 0); }
    else { return array.reduce((sum, curNum) => sum + curNum, 0); }
}

/**
 * Calculates the mean of an array, optionally calling a function on each element before averaging.
 * @param {!Array.<number>} array - The array of `numbers` to average.
 * @param {?function(number, ...any):number=} func - A `function` to call on each element.
 * @param  {...any} args - Extra arguments to pass to `func`. These are passed after the current
 *      element in the array.
 * @returns {number} The mean of the elements of the array.
 */
const arrayMean = function (array, func = null, ...args) {
    return arraySum(array, func, ...args) / array.length;
}

/**
 * Constructs a new `Object` by setting each key to its value run through a `function`.
 * @param {!Object.<any, any>} obj - The object to map.
 * @param {!function(any, ...any):any} func - A `function` to call on each value.
 * @param  {...any} args - Extra arguments to pass to `func`. These are passed after the current
 *      value of the object.
 * @returns {!Object.<any, any>} The object created by calling `func` on each value in `obj`.
 */
const objectMap = function (obj, func, ...args) {
    const mapped = {};
    for (const [key, value] of Object.entries(obj)) {
        mapped[key] = func(value, ...args);
    }
    return mapped;
}

/**
 * Searches a sorted array for the index of a value.
 * @param {!Array.<any>} arr - The sorted array to search.
 * @param {any} val - The value to find the index of.
 * @param {!function(any, any):number} compareFn - A `function` to compare the array's elements by.
 * @returns {number} If `val` is in `arr`, returns the index of `val`. Otherwise, returns
 *      `-1 * index` where `index` is the index that `val` would be at if it was in `arr`.
 */
const binarySearch = function (arr, val, compareFn) {  // https://stackoverflow.com/a/29018745
    let start = 0;
    let end = arr.length - 1;
    while (start <= end) {
        let mid = (start + end) >> 1;
        let cmp = compareFn(val, arr[mid]);

        if (cmp > 0) { start = mid + 1; }
        else if (cmp < 0) { end = mid - 1; }
        else { return mid; }
    }
    return -start - 1;
}

/**
 * Checks the status of a fetch response, ensuring that the fetch was successful.
 * @param {!Object.<string, any>} res - The response from a fetch request to check.
 * @returns {!Object.<string, any>} The reference to the input response.
 * @throws {Error} If the response status status is unsuccessful. In other words, If
 *      `res.ok != true` or if `res.status != 200`.
 */
const checkResponseStatus = function (res) {
    if (!res.ok) { throw new Error('Network response was not OK'); }  // network error
    else if (res.status != 200) {  // not 200 is error
        throw new Error(`${res.status} ${res.statusText}`);
    }
    return res;
}

export {
    getRandomColor,
    htmlToElement,
    compareProperty,
    sortByProp,
    propertiesEqual,
    toggleButton,
    arraySum,
    arrayMean,
    objectMap,
    binarySearch,
    checkResponseStatus
};