import { beforeEach, describe, test, expect, jest } from "@jest/globals";
import * as util from "../src/util";

const toBeCaseInsensitive = function toBeCaseInsensitive(received, expected) {
  const pass =
    received.localeCompare(expected, undefined, { sensitivity: "accent" }) ===
    0;
  const message = `expected ${received} to case-insensitively equal ${expected}`;
  return { message, pass };
};

expect.extend({ toBeCaseInsensitive });

describe("getRandomColor", () => {
  test('returns a hex string of form "#RRGGBB"', () => {
    expect(util.getRandomColor()).toMatch(/#[abcdef\d]{6}/);
  });
});

// describe("htmlToElement", () => {
//     const element = util.htmlToElement(`<div class="class1 class2">
//         <p style="font-size:30px;" hidden>Lorem ipsum dolor sit amet.</p>
//         <h2>Table of Contents</h2>
//         <ul>
//             <li><a href="#id1" id="link1">link 1</a></li>
//             <li><a href="#id2" id="link2">link 2</a></li>
//             <li><a href="#id3" id="link3">link 3</a></li>
//         </ul>
//     </div>`);

//     test("returns a div Element", () => {
//         expect(element).toBeInstanceOf(Element);
//         expect(element.tagName).toBeCaseInsensitive("div");
//     });

//     test("with classes \"class1\" and \"class2\"", () => {
//         expect(element.classList.contains("class1")).toBe(true);
//         expect(element.classList.contains("class2")).toBe(true);
//     });

//     test("with the 1st child being a paragraph", () => {
//         const p = element.firstElementChild;
//         expect(p.tagName).toBeCaseInsensitive("p");
//         expect(p.hidden).toBe(true);
//         expect(p.style.fontSize).toBeCaseInsensitive("30px");
//     });

//     test("and the 2nd child being a header", () => {
//         const h2 = element.children[1];
//         expect(h2.tagName).toBeCaseInsensitive("h2");
//         expect(h2.innerHTML).toBe("Table of Contents");
//     });

//     test("and the 3rd child being an unordered list", () => {
//         const ul = element.children[2];
//         expect(ul.tagName).toBeCaseInsensitive("ul");

//         for (let i = 0; i < ul.children.length; i++) {
//             const li = ul.children[i];
//             const a = li.firstElementChild;

//             expect(li.tagName).toBeCaseInsensitive("li");
//             expect(a.tagName).toBeCaseInsensitive("a");
//             expect(a.href).toBe(`#id${i + 1}`);
//             expect(a.id).toBe(`link${i + 1}`);
//             expect(a.innerHTML).toBe(`link ${i + 1}`);
//         }
//     });
// });

const obj1 = {
  word1: "alfa",
  word2: "mike",
  word3: "delta",
  num1: 0,
  num2: 100.91,
  num3: 92718,
};
const obj2 = {
  word1: "zulu",
  word2: "golf",
  word3: "delta",
  num1: 2.5,
  num2: 7,
  num3: 92718,
};

describe("compareProperty", () => {
  test("compares lexicographically before", () => {
    expect(util.compareProperty(obj1, obj2, "word1")).toBeLessThan(0);
  });
  test("compares lexicographically after", () => {
    expect(util.compareProperty(obj1, obj2, "word2")).toBeGreaterThan(0);
  });
  test("compares lexicographically equal", () => {
    expect(util.compareProperty(obj1, obj2, "word3")).toBe(0);
  });
  test("compares numerically before", () => {
    expect(util.compareProperty(obj1, obj2, "num1")).toBeLessThan(0);
  });
  test("compares numerically after", () => {
    expect(util.compareProperty(obj1, obj2, "num2")).toBeGreaterThan(0);
  });
  test("compares numerically equal", () => {
    expect(util.compareProperty(obj1, obj2, "num3")).toBe(0);
  });
});

const obj3 = { word1: "echo", num1: 25.6 };
const obj4 = { word1: "victor", num1: 36.01 };
const obj5 = { word1: "quebec", num1: 58 };
const obj6 = { word1: "oscar", num1: 2.5 };
const obj7 = { word1: "kilo", num1: 17.9 };
const obj8 = { word1: "alfa", num1: 23 };

describe("sortByProp", () => {
  let objs;
  beforeEach(() => (objs = [obj1, obj2, obj3, obj4, obj5, obj6, obj7, obj8]));

  test("sorts lexicographically", () => {
    expect(util.sortByProp(objs, "word1")).toEqual([
      obj1,
      obj8,
      obj3,
      obj7,
      obj6,
      obj5,
      obj4,
      obj2,
    ]);
  });
  test("sorts lexicographically in reverse", () => {
    expect(util.sortByProp(objs, "word1", { reverse: true })).toEqual([
      obj2,
      obj4,
      obj5,
      obj6,
      obj7,
      obj3,
      obj1,
      obj8,
    ]);
  });
  test("sorts numerically", () => {
    expect(util.sortByProp(objs, "num1")).toEqual([
      obj1,
      obj2,
      obj6,
      obj7,
      obj8,
      obj3,
      obj4,
      obj5,
    ]);
  });
  test("sorts numerically in reverse", () => {
    expect(util.sortByProp(objs, "num1", { reverse: true })).toEqual([
      obj5,
      obj4,
      obj3,
      obj8,
      obj7,
      obj2,
      obj6,
      obj1,
    ]);
  });
});

describe("propertiesEqual", () => {
  test("compares equal", () => {
    expect(util.propertiesEqual(obj1, obj2, ["word3"])).toBe(true);
    expect(util.propertiesEqual(obj1, obj2, ["word3", "num3"])).toBe(true);
  });
  test("compares not equal", () => {
    expect(util.propertiesEqual(obj1, obj2, ["num1"])).toBe(false);
    expect(util.propertiesEqual(obj1, obj2, ["num1", "word3"])).toBe(false);
  });
});

// describe("toggleButton", () => { });

const nums = [6, -1, 90, 1, 19, -55, 34, 10, 76, -9];
const floorHalve = (num) => Math.floor(num / 2);
// flooredHalvedNums = [3, -1, 45, 0, 9, -28, 17, 5, 38, -5]
// javascript "%" is remainder not modulus
const remainder = (dividend, divisor) => dividend % divisor;
// remainderedNums = [2, -1, 2, 1, 3, -3, 2, 2, 0, -1]

describe("arraySum", () => {
  test("sums without applying a function", () => {
    expect(util.arraySum(nums)).toBe(171);
  });
  test("sums with applying a function", () => {
    expect(util.arraySum(nums, floorHalve)).toBe(83);
    expect(util.arraySum(nums, remainder, 4)).toBe(7);
  });
});

describe("arrayMean", () => {
  test("averages without applying a function", () => {
    expect(util.arrayMean(nums)).toBeCloseTo(17.1, 7);
  });
  test("averages with applying a function", () => {
    expect(util.arrayMean(nums, floorHalve)).toBeCloseTo(8.3, 7);
    expect(util.arrayMean(nums, remainder, 4)).toBeCloseTo(0.7, 7);
  });
});

const strings = {
  string1: "        november   ",
  string2: " sierra   ",
  string3: "charlie",
  string4: "     hotel                 ",
  string5: "   tango      ",
};
const trim = (string) => string.trim();
const indexOf = (string, search, position = 0) =>
  string.indexOf(search, position);

describe("objectMap", () => {
  test("maps the object's values through the function", () => {
    expect(util.objectMap(strings, trim)).toEqual({
      string1: "november",
      string2: "sierra",
      string3: "charlie",
      string4: "hotel",
      string5: "tango",
    });
    expect(util.objectMap(strings, indexOf, "a")).toEqual({
      string1: -1,
      string2: 6,
      string3: 2,
      string4: -1,
      string5: 4,
    });
  });
});

const sortedNums = [-90, -58, -44, -21, -8, -7, 1, 3, 11, 12, 56, 109];
const numcmp = (num1, num2) => num1 - num2;

describe("binarySearch", () => {
  test("returns correct index of value in array", () => {
    expect(util.binarySearch(sortedNums, -44, numcmp)).toBe(2);
    expect(util.binarySearch(sortedNums, -7, numcmp)).toBe(5);
    expect(util.binarySearch(sortedNums, 56, numcmp)).toBe(10);
  });
  test("returns negative index of where value would go in array", () => {
    expect(util.binarySearch(sortedNums, -13, numcmp)).toBe(-4);
    expect(util.binarySearch(sortedNums, 0, numcmp)).toBe(-6);
    expect(util.binarySearch(sortedNums, 110, numcmp)).toBe(-12);
  });
});

const successfulFetch = jest.fn(() =>
  Promise.resolve({ ok: true, status: 200 })
);
const unsuccessfulFetch = jest.fn(() =>
  Promise.resolve({ ok: false, status: 0 })
);

describe("checkResponseStatus", () => {
  test("doesn't throw on successful response", () => {
    successfulFetch().then((res) => {
      // have to wrap in () => for .toThrow to properly detect a thrown error
      expect(() => util.checkResponseStatus(res)).not.toThrow();
    });
  });
  test("throws on unsuccessful response", () => {
    unsuccessfulFetch().then((res) => {
      // have to wrap in () => for .toThrow to properly detect a thrown error
      expect(() => util.checkResponseStatus(res)).toThrow();
    });
  });
});
