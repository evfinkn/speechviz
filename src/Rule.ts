import { htmlToElement } from "./util";

/**
 * Casts the value(s) to the given type.
 * @param {(any|any[])} value - The value to cast. If an array, each element is
 *      cast.
 * @param {?string} type - The type to cast the values to. If `null`, the values are
 *      not cast. Otherwise, it must be "number", "string", or "boolean".
 * @returns {(any|any[])} The casted value(s).
 */
const cast = (value, type = null) => {
  if (type === null) {
    return value;
  } else if (type === "number") {
    type = Number;
  } else if (type === "string") {
    type = String;
  } else if (type === "boolean") {
    type = Boolean;
  } else {
    throw new Error(`Invalid type: ${type}`);
  }
  if (Array.isArray(value)) {
    return value.map(type);
  }
  return type(value);
};

/**
 * A class representing a rule (e.g. "is less than", "includes", etc.) that can be
 * used to filter items by an attribute.
 */
const Rule = class Rule {
  /**
   * The name of the rule.
   * This is displayed in the select element that contains the rules.
   * @type {string}
   */
  name;

  /**
   * The function that is used to check if an attribute passes the rule.
   * @type {function}
   */
  rule;

  /**
   * The type of the values.
   * Values will be cast to this type before being passed to the rule function.
   * If `null`, the values will not be cast to anything. Valid types are "number",
   * "string", "boolean".
   * @type {?string}
   */
  type: "number" | "string" | "boolean" = null;

  /**
   * The number of values that the rule expects.
   * @type {number}
   */
  expectedNumberOfValues;

  /**
   * The strings that are between the value inputs, if any.
   * Only applicable if the `expectedNumberOfValues` > 1.
   * An exmaple is for the number rule "is in the range", which has 2 values and has
   * the string "to" between them.
   * @type {?string[]}
   */
  stringsBetweenValues = null;

  /**
   * Whether the rule expects another rule to be applied to the result of this rule.
   * @type {boolean}
   */
  expectsNextRule = false;

  /**
   * The rule applied to the result of this rule, if any.
   * An example for a rule that would need another rule is "item at index" for arrays,
   * which needs another rule to check against the element at the index.
   * @type {?Rule}
   */
  nextRule = null;

  /**
   * The type the next rule should be, or `null` if no next rule is expected.
   * @type {?string}
   */
  nextRuleType = null;

  /**
   * The inputs that contain the values for the rule.
   * `null` if the rule has not been added to the DOM yet.
   * @type {?HTMLInputElement[]}
   */
  valueInputs = null;
  select: any;

  /**
   * @param {string} name - The name of the rule displayed in the select element.
   * @param {function} rule - The function to test if an attribute passes the rule.
   * @param {Object} options - The options for the rule.
   * @param {?string=} options.type - The type to cast the values to, if any.
   * @param {number} [options.expectedNumberOfValues=1] - The number of values the rule
   *    expects.
   * @param {?string[]=} options.stringsBetweenValues - The strings displayed between
   *    the value inputs, if any.
   * @param {boolean} [options.expectsNextRule=false] - Whether the rule expects
   *    another rule to be applied to the result of this rule.
   * @param {?Rule=} options.nextRule - The rule applied to the result of this rule,
   *    if any.
   * @param {?string=} options.nextRuleType - The type the next rule should be, or
   *    `null` if no next rule is expected.
   */
  constructor(
    name,
    rule,
    {
      type = null,
      expectedNumberOfValues = 1,
      stringsBetweenValues = null,
      expectsNextRule = false,
      nextRule = null,
      nextRuleType = null,
    } = {}
  ) {
    this.name = name;
    this.rule = rule;
    this.type = type;
    this.expectedNumberOfValues = expectedNumberOfValues;
    this.stringsBetweenValues = stringsBetweenValues;
    this.expectsNextRule = expectsNextRule;
    this.nextRule = nextRule;
    this.nextRuleType = nextRuleType;
    this.select = undefined;
  }

  /**
   * Gets a copy of the rule.
   * Note that this is a deep copy, so `nextRule` is also copied (and
   * `nextRule.nextRule` is copied, etc.) if it is not `null`.
   * @returns {Rule} - A copy of the rule.
   */
  copy() {
    return new Rule(this.name, this.rule, {
      type: this.type,
      expectedNumberOfValues: this.expectedNumberOfValues,
      stringsBetweenValues: this.stringsBetweenValues,
      expectsNextRule: this.expectsNextRule,
      nextRule: this.nextRule === null ? null : this.nextRule.copy(),
      nextRuleType: this.nextRuleType,
    });
  }

  /**
   * Gets a copy of the rule with the given type.
   * @param {string} type - The type to give the copied rule.
   * @returns {Rule} - A copy of the rule with the given type.
   */
  withType(type) {
    const copy = this.copy();
    copy.type = type;
    return copy;
  }

  /**
   * Checks if the attribute passes the rule.
   * @param {any} attr - The attribute to check.
   * @returns {boolean} - The result of calling the rule function with the attribute
   *     and the values from the input elements (if any).
   */
  passesRule(attr) {
    const values = [];
    for (const input of this.valueInputs) {
      values.push(cast(input.value, this.type));
    }
    const result = this.rule(attr, ...values);
    if (this.nextRule !== null) {
      return this.nextRule.passesRule(result);
    }
    return result;
  }

  /**
   * Gets the input elements that are used to enter values for the rule.
   * @returns {HTMLInputElement[]} - The inputs used to enter values for the rule.
   */
  getElements() {
    const elements = [];
    if (this.valueInputs === null) {
      this.valueInputs = [];
      for (let i = 0; i < this.expectedNumberOfValues; i++) {
        const input = htmlToElement(
          `<input type="text" placeholder="${this.type}">`
        );
        this.valueInputs.push(input);
        // if (i < this.expectedNumberOfValues - 1) {
        //   elements.push(document.createTextNode(this.stringsBetweenValues[i]));
        // }
      }
    }
    elements.push(...this.valueInputs);
    return elements;
  }
};

const isLess = new Rule("is less than", (attr, val) => attr < val);
const isLessEqual = new Rule(
  "is less than or equal to",
  (attr, val) => attr <= val
);
const isGreater = new Rule("is greater than", (attr, val) => attr > val);
const isGreaterEqual = new Rule(
  "is greater than or equal to",
  (attr, val) => attr >= val
);
const isEqualTo = new Rule("is equal to", (attr, val) => attr === val);
const isNotEqualTo = new Rule("is not equal to", (attr, val) => attr !== val);
const isInRange = new Rule(
  "is in the range",
  (attr, min, max) => min <= attr && attr <= max
);
isInRange.stringsBetweenValues = ["to"];
isInRange.expectedNumberOfValues = 2;
const includes = new Rule("includes", (attr, val) => attr.includes(val));
const doesNotInclude = new Rule(
  "does not include",
  (attr, val) => !attr.includes(val)
);
const itemAtIndex = new Rule("item at index", (attr, index) => attr.at(index), {
  type: "number",
});
itemAtIndex.expectsNextRule = true;
const indexOf = new Rule("index of", (attr, val) => attr.indexOf(val));
indexOf.expectsNextRule = true;
indexOf.nextRuleType = "number";
const lastIndexOf = new Rule("last index of", (attr, val) =>
  attr.lastIndexOf(val)
);
lastIndexOf.expectsNextRule = true;
lastIndexOf.nextRuleType = "number";
const startsWith = new Rule("starts with", (attr, val) => attr.startsWith(val));
const endsWith = new Rule("ends with", (attr, val) => attr.endsWith(val));
const length = new Rule("length", (attr) => attr.length);
length.expectedNumberOfValues = 0;
length.expectsNextRule = true;
length.nextRuleType = "number";
const hasKey = new Rule("has key", (attr, key) => Object.hasOwn(attr, key), {
  type: "string",
});
const doesNotHaveKey = new Rule(
  "does not have key",
  (attr, key) => !Object.hasOwn(attr, key),
  { type: "string" }
);
const valueAtKey = new Rule("value at key", (attr, key) => attr[key], {
  type: "string",
});
valueAtKey.expectsNextRule = true;
const isTrue = new Rule("is true", (attr) => attr === true, {
  type: "boolean",
});
isTrue.expectedNumberOfValues = 0;
const isFalse = new Rule("is false", (attr) => attr === false, {
  type: "boolean",
});
isFalse.expectedNumberOfValues = 0;

/**
 * Rules that can be applied to numbers.
 * The key is the name of the rule, and the rule is the value.
 * @type {Object.<string, Rule>}
 */
const NumberRules = {};
NumberRules[isLess.name] = isLess.withType("number");
NumberRules[isLessEqual.name] = isLessEqual.withType("number");
NumberRules[isGreater.name] = isGreater.withType("number");
NumberRules[isGreaterEqual.name] = isGreaterEqual.withType("number");
NumberRules[isEqualTo.name] = isEqualTo.withType("number");
NumberRules[isNotEqualTo.name] = isNotEqualTo.withType("number");
NumberRules[isInRange.name] = isInRange.withType("number");

/**
 * Rules that can be applied to strings.
 * The key is the name of the rule, and the rule is the value.
 * @type {Object.<string, Rule>}
 */
const StringRules = {};
StringRules[isEqualTo.name] = isEqualTo.withType("string");
StringRules[isNotEqualTo.name] = isNotEqualTo.withType("string");
StringRules[includes.name] = includes.withType("string");
StringRules[doesNotInclude.name] = doesNotInclude.withType("string");
StringRules[startsWith.name] = startsWith.withType("string");
StringRules[endsWith.name] = endsWith.withType("string");
StringRules[length.name] = length;
StringRules[indexOf.name] = indexOf.withType("string");
StringRules[lastIndexOf.name] = lastIndexOf.withType("string");

/**
 * Rules that can be applied to booleans.
 * The key is the name of the rule, and the rule is the value.
 * @type {Object.<string, Rule>}
 */
const BooleanRules = {};
BooleanRules[isTrue.name] = isTrue;
BooleanRules[isFalse.name] = isFalse;

/**
 * Rules that can be applied to arrays.
 * The key is the name of the rule, and the rule is the value.
 * @type {Object.<string, Rule>}
 */
const ArrayRules = {};
ArrayRules[includes.name] = includes;
ArrayRules[doesNotInclude.name] = doesNotInclude;
ArrayRules[itemAtIndex.name] = itemAtIndex;
ArrayRules[length.name] = length;
ArrayRules[indexOf.name] = indexOf;
ArrayRules[lastIndexOf.name] = lastIndexOf;

/**
 * Rules that can be applied to objects.
 * The key is the name of the rule, and the rule is the value.
 * @type {Object.<string, Rule>}
 */
const ObjectRules = {};
ObjectRules[hasKey.name] = hasKey;
ObjectRules[doesNotHaveKey.name] = doesNotHaveKey;
ObjectRules[valueAtKey.name] = valueAtKey;
ObjectRules[length.name] = length;

/**
 * A mapping of types to the rules that can be applied to them.
 * The key is the name of the type, and the value is an object of rules for that type.
 * @type {Object.<string, Object.<string, Rule>>}
 * @property {Object.<string, Rule>} number
 * @property {Object.<string, Rule>} string
 * @property {Object.<string, Rule>} boolean
 * @property {Object.<string, Rule>} array
 * @property {Object.<string, Rule>} object
 */
const Rules = {};
Rules["number"] = NumberRules;
Rules["string"] = StringRules;
Rules["boolean"] = BooleanRules;
Rules["array"] = ArrayRules;
Rules["object"] = ObjectRules;

export {
  Rule,
  NumberRules,
  StringRules,
  BooleanRules,
  ArrayRules,
  ObjectRules,
  Rules,
};
