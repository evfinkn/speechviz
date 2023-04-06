import { Type, Attributes } from "./Attribute.js";
import { Rules } from "./Rule.js";
import { TreeItem } from "./treeClasses.js";
import { htmlToElement } from "./util.js";
import { plusIcon, minusIcon } from "./icon.js";

// The idea for the layout and concept of the filtering was inspired by
// Apple's various smart collections in their apps, such as Smart Albums in
// Photos and Smart Playlists in Music.

/**
 * An element used to filter a `TreeItem` based on one of its attributes.
 * Contains a select element to select the attribute to filter on, and a select
 * element to select the rule to filter on (and possibly some inputs to enter
 * values for the rule, as well as any more rules to filter on).
 */
const FilterElement = class FilterElement {
  /**
   * The `li` element that contains all other elements.
   * @type {!Element}
   */
  li;

  /**
   * The checkbox used to enable or disable the filter.
   * @type {!Element}
   */
  checkbox;

  /**
   * The attribute to filter on. Set when the select element is changed.
   * @type {!Attribute}
   */
  attribute;

  /**
   * The select element to select the attribute to filter on.
   * @type {!Element}
   */
  attributeSelect;

  /**
   * The rules to filter on. The first rule is the rule to filter on the
   * attribute, and following rules (if any) filter the result of the previous
   * rule.
   * @type {!Array<!Rule>}
   */
  rules;

  removeButton;

  constructor(parent) {
    this.li = document.createElement("li");
    this.checkbox = htmlToElement(
      `<input type="checkbox" autocomplete="off" checked>`
    );
    this.li.appendChild(this.checkbox);
    this.attributeSelect = document.createElement("select");
    for (const attribute of Object.keys(Attributes)) {
      const option = document.createElement("option");
      option.value = attribute;
      option.innerText = attribute;
      this.attributeSelect.appendChild(option);
    }
    this.li.appendChild(this.attributeSelect);
    this.attributeSelect.addEventListener("change", () => {
      this.attribute = Attributes[this.attributeSelect.value];
      this.generateRuleElements(this.attribute.type);
    });
    this.attribute = Attributes[this.attributeSelect.value];
    this.removeButton = htmlToElement(
      `<a href="javascript:;" class="button-on">${minusIcon}</a>`
    );
    this.removeButton.addEventListener("click", () => {
      this.li.remove();
      parent.removeFilter(this);
    });
    this.li.appendChild(this.removeButton);
    this.rules = [];
    this.generateRuleElements(this.attribute.type);
  }

  /**
   * Generates the rule elements for the attribute.
   * @param {!Type} attributeType - The type of the attribute / value that will be
   *    filtered on.
   * @param {?Element=} select - The select element to use to select the rule. If
   *    `null`, a new select element will be created.
   * @param {number} [index=0] - The index of the rule to generate elements for.
   *    If the index is less than the number of rules, the rules after and at the index
   *    will be removed.
   * @returns {Rule} The rule that was generated.
   */
  generateRuleElements(attributeType, select = null, index = 0) {
    if (index < this.rules.length) {
      this.rules[index].valueInputs.forEach((input) => input.remove());
      if (this.rules[index].select !== select) {
        this.rules[index].select.remove();
      }
      this.rules.slice(index + 1).forEach((rule) => {
        rule.select.remove();
        rule.valueInputs.forEach((input) => input).remove();
      });
      this.rules = this.rules.slice(0, index);
    }
    if (!select) {
      select = document.createElement("select");

      for (const rule of Object.values(Rules[attributeType.type])) {
        const option = document.createElement("option");
        option.value = rule.name;
        option.innerText = rule.name;
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        this.generateRuleElements(attributeType, select, index);
      });
      // this.li.appendChild(select);
      this.removeButton.before(select);
    }

    let rule = Rules[attributeType.type][select.value];
    if (rule.type !== null) {
      rule = rule.copy();
    } else if (
      attributeType.type === "array" ||
      attributeType.type === "object"
    ) {
      rule = rule.withType(attributeType.innerType.type);
    } else {
      rule = rule.withType(attributeType.type);
    }

    rule.select = select;
    const valueInputs = rule.getElements();
    for (const input of valueInputs) {
      // this.li.appendChild(input);
      this.removeButton.before(input);
    }

    if (this.rules.length !== 0 && index < this.rules.length) {
      this.rules.at(-1).nextRule = rule;
    }
    this.rules.push(rule);

    if (rule.expectsNextRule) {
      if (rule.nextRuleType) {
        this.generateRuleElements(new Type(rule.nextRuleType), null, index + 1);
      } else {
        this.generateRuleElements(attributeType.innerType, null, index + 1);
      }
    }

    return rule;
  }

  /**
   * Given a `TreeItem`'s attributes, returns whether the `TreeItem` passes this
   * filter.
   * @param {!Object<string, *>} attributes - The attributes of the `TreeItem`.
   * @param {boolean} [passIfNoAttribute=true] - Whether the item should pass if
   *    it doesn't have the attribute this filter is filtering on.
   * @returns {boolean} Whether the `TreeItem` passes this filter's rules.
   */
  passesFilter(attributes, passIfNoAttribute = false) {
    if (
      attributes === null ||
      !Object.hasOwn(attributes, this.attribute.name)
    ) {
      return passIfNoAttribute;
    }
    const attribute = attributes[this.attribute.name];
    // only need to pass it to first rule because first rule forwards it to next ones
    return this.rules[0].passesRule(attribute);
  }
};

/** A popup to filter `TreeItem`s based on their attributes. */
const FiltersPopup = class FiltersPopup {
  /**
   * The div element that contains all other elements.
   * Displayed when the settings button is clicked.
   * @type {!Element}
   */
  popup;

  /**
   * The div element containing the actual content of the popup.
   * @type {!Element}
   */
  popupContent;

  /**
   * The `ul` element that contains the `FilterElement`s.
   * @type {!Element}
   */
  ul;

  /**
   * The `FilterElement`s that are in the popup.
   * @type {!Array<!FilterElement>}
   */
  filters;

  constructor() {
    this.popup = htmlToElement("<div class='popup'></div>");
    document.body.append(this.popup);

    const popupContent = htmlToElement(
      "<div class='popup-content' style='width:70%;'></div>"
    );
    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);

    const title = htmlToElement("<h2>Filters</h2>");
    popupContent.appendChild(title);

    const topDiv = htmlToElement("<div class='space-between'></div>");
    popupContent.appendChild(topDiv);

    const matchType = htmlToElement(
      `<label>
        <input type="checkbox" autochecked="off" checked></input>
         Match <select></select> of the following rules:
      </label>`
    );
    const [doFilteringCheckbox, matchTypeSelect] = matchType.children;
    this.doFilteringCheckbox = doFilteringCheckbox;
    doFilteringCheckbox.addEventListener("change", () => {
      this.ul.classList.toggle("grayed-out", !doFilteringCheckbox.checked);
    });
    this.matchTypeSelect = matchTypeSelect;
    matchTypeSelect.appendChild(
      htmlToElement("<option value='all'>all</option>")
    );
    matchTypeSelect.appendChild(
      htmlToElement("<option value='any'>any</option>")
    );
    topDiv.appendChild(matchType);

    this.filters = [];

    const addButton = htmlToElement(
      `<a href="javascript:;" class="button-on">${plusIcon}</a>`
    );
    topDiv.appendChild(addButton);
    addButton.addEventListener("click", () => {
      const filterElement = new FilterElement(this);
      this.filters.push(filterElement);
      this.ul.appendChild(filterElement.li);
    });

    this.ul = document.createElement("ul");
    popupContent.appendChild(this.ul);

    const bottomDiv = htmlToElement(
      "<div style='display:flex;justify-content:flex-end;'></div>"
    );
    popupContent.appendChild(bottomDiv);

    const cancelButton = htmlToElement("<button>Cancel</button>");
    bottomDiv.appendChild(cancelButton);
    cancelButton.addEventListener("click", () => this.hide());

    const applyButton = htmlToElement("<button>Apply</button>");
    bottomDiv.appendChild(applyButton);
    applyButton.addEventListener("click", () => {
      this.applyFilters();
      this.hide();
    });
  }

  removeFilter(filter) {
    this.filters = this.filters.filter((f) => f !== filter);
  }

  /** Displays this popup. */
  show() {
    this.popup.style.display = "block";
  }

  /** Hides this popup. */
  hide() {
    this.popup.style.display = "none";
  }

  passesAllFilters(attr) {
    const filters = this.filters.filter((filter) => filter.checkbox.checked);
    for (const filter of filters) {
      if (!filter.passesFilter(attr)) {
        return false;
      }
    }
    return true;
  }

  passesAnyFilter(attr) {
    const filters = this.filters.filter((filter) => filter.checkbox.checked);
    for (const filter of filters) {
      if (filter.passesFilter(attr)) {
        return true;
      }
    }
    return false;
  }

  /** Applies the filters to the `TreeItem`s. */
  applyFilters() {
    if (!this.doFilteringCheckbox.checked) {
      Object.values(TreeItem.byId).forEach((item) => {
        item.span.style.color = "black";
      });
      return;
    }
    const pass = (item) => (item.span.style.color = "red");
    const fail = (item) => (item.span.style.color = "black");
    let passesFilters;
    if (this.matchTypeSelect.value === "all") {
      passesFilters = this.passesAllFilters.bind(this);
    } else {
      passesFilters = this.passesAnyFilter.bind(this);
    }
    Object.values(TreeItem.byId).forEach((item) => {
      if (passesFilters(item.attributes)) {
        pass(item);
      } else {
        fail(item);
      }
    });
  }
};

export { FiltersPopup };
