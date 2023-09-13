/**
 * Generates a random color.
 * @returns {!Color} The randomly generated color.
 */
const getRandomColor = function () {
  // Get a random number between 0 and 256, convert it to a hex string, and pad with 0
  const r = Math.floor(Math.random() * 256)
    .toString(16)
    .padStart(2, "0");
  const g = Math.floor(Math.random() * 256)
    .toString(16)
    .padStart(2, "0");
  const b = Math.floor(Math.random() * 256)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
};

/**
 * Generates an HTMLElement from a string containing HTML.
 * @param {string} html - The `string` containing the HTML.
 * @returns {?Element} The `Element` represented by `html`.
 */
const htmlToElement = function (html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.firstElementChild;
};

/**
 * Generates HTMLElements from a template string.
 * @param {TemplateStringsArray} strings - An array of strings surrounding the
 *      values being interpolated into the template string.
 * @param {...any} values - The values being interpolated into the template string.
 * @returns {?(Element|Array.<Element>)} The `Element` or `Array` of `Element`s
 *      represented by the template string. If the template string contains more
 *      than one root element, an `Array` of `Element`s is returned. Otherwise, a
 *      single `Element` is returned.
 */
const html = function (strings, ...values) {
  // String.raw can be used like this to get the processed template string
  // We use it here because we don't need the individual strings and values
  const htmlString = String.raw({ raw: strings }, ...values);
  const template = document.createElement("template");
  template.innerHTML = htmlString;
  if (template.content.children.length > 1) {
    return Array.from(template.content.children);
  }
  return template.content.firstElementChild;
};

/**
 * Compares two strings using natural sort order.
 * @param {string} a - The first string to compare.
 * @param {string} b - The second string to compare.
 * @returns {number} A negative number if `a` is before `b`, a positive number if `a`
 *      is after `b`, or `0` if `a` equals `b`.
 * @see {@link https://en.wikipedia.org/wiki/Natural_sort_order Natural sort order}
 */
const naturalCompare = function (a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
};

/**
 * Compares two `Objects` by one of their properties.
 * Uses less than and greater than to compare the properties.
 * @param {!Object.<any, any>} obj1 - An object to compare.
 * @param {!Object.<any, any>} obj2 - An object to compare.
 * @param {any} property - The name of the property to compare the objects by.
 * @returns {number} A negative number if `obj1` is less than / before `obj2`,
 *      a positive number if `obj1` is greater than / after `obj2`, or `0` if
 *      `obj1` equals `obj2`.
 */
const compareProperty = function (obj1, obj2, property) {
  if (obj1[property] < obj2[property]) {
    return -1;
  }
  if (obj1[property] > obj2[property]) {
    return 1;
  }
  return 0;
};

/**
 * Sorts an array of `Object`s in place by a property of its elements.
 * @param {!Array.<Object.<any, any>>} array - The array of objects to sort.
 * @param {any} property - The name of the property to sort by.
 * @param {Object} options - The options for sorting.
 * @param {boolean} [options.reverse=false] - If `false`, the array is sorted in
 *      ascending order. Otherwise, the array is sorted in descending order.
 * @returns {!Array.<Object.<any, any>>} The reference to the original array, now
 *      sorted.
 */
const sortByProp = function (array, property, { reverse = false } = {}) {
  const reverseNum = reverse ? -1 : 1;
  array.sort(
    (obj1, obj2) => compareProperty(obj1, obj2, property) * reverseNum
  );
  return array;
};

/**
 * Tests if the given properties of two `Object`s are equal.
 * @param {!Object.<any, any>} obj1 - An object to compare.
 * @param {!Object.<any, any>} obj2 - An object to compare.
 * @param {!Array.<any>} properties - An array of the names of the properties to
 *      compare by.
 * @returns {boolean} `true` if all of the given properties of the objects are equal.
 *      Otherwise, `false`.
 */
const propertiesEqual = function (obj1, obj2, properties) {
  for (const prop of properties) {
    if (obj1[prop] != obj2[prop]) {
      return false;
    }
  }
  return true;
};

/**
 * Toggles a button on /off.
 * Specifically, makes a button clickable / unclickable and colors it black / gray.
 * @param {!Element} button - The button element to toggle.
 * @param {boolean=} force - If unspecified, `button` is always toggled. Otherwise,
 *      `button` is only toggled if its current state isn't equal to `force`.
 * @returns {boolean} A `boolean` indiciating if any toggling was done. In other words,
 *      when `force == null`, returns `true`. Otherwise, returns `force !== clickable`.
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
};

/**
 * Sums the elements of an array, optionally calling a function on each element
 * before summing.
 * @param {!Array.<number>} array - The array of `numbers` to sum.
 * @param {?function(number, ...any):number=} func - A `function` to call on
 *      each element.
 * @param  {...any} args - Extra arguments to pass to `func`. These are passed
 *      after the current element in the array.
 * @returns {number} The sum of the elements of the array.
 */
const arraySum = function (array, func = null, ...args) {
  if (func) {
    return array.reduce((sum, curNum) => sum + func(curNum, ...args), 0);
  } else {
    return array.reduce((sum, curNum) => sum + curNum, 0);
  }
};

/**
 * Calculates the mean of an array, optionally calling a function on each element
 * before averaging.
 * @param {!Array.<number>} array - The array of `numbers` to average.
 * @param {?function(number, ...any):number=} func - A `function` to call on
 *      each element.
 * @param  {...any} args - Extra arguments to pass to `func`. These are passed after
 *      the current element in the array.
 * @returns {number} The mean of the elements of the array.
 */
const arrayMean = function (array, func = null, ...args) {
  return arraySum(array, func, ...args) / array.length;
};

/**
 * Constructs a new `Object` by setting each key to its value run through a `function`.
 * @param {!Object.<any, any>} obj - The object to map.
 * @param {!function(any, ...any):any} func - A `function` to call on each value.
 * @param  {...any} args - Extra arguments to pass to `func`. These are passed after
 *      the current value of the object.
 * @returns {!Object.<any, any>} The object created by calling `func` on each value
 *      in `obj`.
 */
const objectMap = function (obj, func, ...args) {
  const mapped = {};
  for (const [key, value] of Object.entries(obj)) {
    mapped[key] = func(value, ...args);
  }
  return mapped;
};

/**
 * Searches a sorted array for the index of a value.
 * @param {!Array.<any>} arr - The sorted array to search.
 * @param {any} val - The value to find the index of.
 * @param {!function(any, any):number} compareFn - A `function` to compare the
 *      array's elements by.
 * @returns {number} If `val` is in `arr`, returns the index of `val`. Otherwise,
 *      returns `-1 * index` where `index` is the index that `val` would be at if
 *      it were in `arr`.
 */
const binarySearch = function (arr, val, compareFn) {
  // https://stackoverflow.com/a/29018745
  let start = 0;
  let end = arr.length - 1;
  while (start <= end) {
    const mid = (start + end) >> 1;
    const cmp = compareFn(val, arr[mid]);

    if (cmp > 0) {
      start = mid + 1;
    } else if (cmp < 0) {
      end = mid - 1;
    } else {
      return mid;
    }
  }
  return -start;
};

/**
 * An error that can be thrown when an unexpected `Response` is received.
 * Mostly useful for throwing an error when a response has an unsuccessful status.
 * @extends Error
 */
const ResponseError = class ResponseError extends Error {
  /**
   * The `Response` object that caused this error.
   * @type {Response}
   */
  response;

  // the next 2 properties are just to make them easier to access
  // e.g. error.response.status vs. error.status
  /**
   * The status code of `response`.
   * @type {number}
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Response/status|Response.status}
   */
  status;

  /**
   * The status message corresponding to the status code. (e.g., OK for 200).
   * @type {string}
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Response/statusText|Response.statusText}
   */
  statusText;

  /**
   * @param {Response} response - The `Response` object that caused this error.
   * @param {string} [body=null] - The body of the response.
   */
  constructor(response, body = null) {
    let message = `${response.status} ${response.statusText}`;
    if (body && body != response.statusText && body.length > 0) {
      message += ` - ${body}`;
    }
    super(message);
    this.name = "ResponseError";
    this.response = response;
    this.status = response.status;
    this.statusText = response.statusText;
  }
};

/**
 * Checks the status of a fetch response, ensuring that the fetch was successful.
 * @param {Response} res - The response to check.
 * @returns {Response} The response, if it was successful.
 * @throws {ResponseError} If the response status status is unsuccessful. In other
 *      words, if `res.ok != true`.
 */
const checkResponseStatus = async function (res) {
  // !res.ok when res.status isn't in the range 200 - 299 (successful statuses)
  if (!res.ok) {
    const body = await res.text();
    throw new ResponseError(res, body);
  }
  return res;
};

/**
 * Parses floats from the text of a CSV file. The first row of the file is assumed
 * to be a header row and is therefore ignored.
 * @param {string} text - The text of the CSV file.
 * @returns {number[][]} An array of arrays of numbers. Each inner array corresponds
 *      to a row in the original file.
 */
const parseNumericalCsv = function (text) {
  return (
    text
      .split("\n")
      // slice starting at 1 to exclude header row
      // to -1 so that last row is excluded, which is just "" (NaN)
      .slice(1, -1) // exclude header row
      .map((row) => row.split(",").map(parseFloat))
  );
};

/**
 * Removes the last extension from the file name.
 * @example
 * removeExtension("dir") // returns "dir"
 * @example
 * removeExtension("./file.txt") // returns "./file"
 * @example
 * removeExtension("file.tar.gz") // returns "file.tar"
 * @param {string} filename - The name of the file.
 * @returns {string} The name of the file excluding the extension.
 */
const removeExtension = function (filename) {
  return filename.replace(/\.[^/.]+$/, "");
};

/**
 * Converts an object into a string representation.
 * @param {*} mapping
 * @param {number} indent
 * @returns
 */
const mappingToString = (mapping, indent = 0) => {
  if (typeof mapping !== "object") {
    return `${" ".repeat(indent)}${mapping},`;
  }
  let string = "";
  for (const [key, value] of Object.entries(mapping)) {
    if (Array.isArray(value)) {
      const arrayString = value
        .map((item) => mappingToString(item, indent + 2))
        .join("\n");
      string += `${key}: [\n${arrayString}\n]\n`;
    } else if (typeof value === "object") {
      string += `${key}: {\n${mappingToString(value, indent + 2)}}\n`;
    } else {
      string += `${" ".repeat(indent)}${key}: ${value}\n`;
    }
  }
  return string;
};

/**
 * @param {string} subdir - The name of the data subdirectory containing the file being
 *    fetched. Shouldn't include the trailing and leading slash.
 * @param {string} basename - The name of the file without the suffix.
 * @param {string} suffix - The suffix of the filename, including the period.
 * @param {string} folder - The name of the folder containing the file. If the file
 *   is in the root of `subdir`, this should be `null`.
 * @example
 * // returns "/segments/file1-segments.json"
 * getUrl("segments", "file1", "-segments.json")
 * @example
 * // returns "/audio/folder1/file1.wav"
 * getUrl("audio", "file1", ".wav", "folder1")
 * @returns {string} The path to the file.
 */
const getUrl = (subdir, basename, suffix, folder = null) => {
  if (folder !== undefined && folder !== null) {
    return `/${subdir}/${folder}/${basename}${suffix}`;
  } else {
    return `/${subdir}/${basename}${suffix}`;
  }
};

export {
  getRandomColor,
  htmlToElement,
  html,
  naturalCompare,
  compareProperty,
  sortByProp,
  propertiesEqual,
  toggleButton,
  arraySum,
  arrayMean,
  objectMap,
  binarySearch,
  ResponseError,
  checkResponseStatus,
  parseNumericalCsv,
  removeExtension,
  mappingToString,
  getUrl,
};
