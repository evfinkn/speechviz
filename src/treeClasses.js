// I really hate to put all of these classes in one file, but there was an issue with
// webpack where TreeItem.byId would be an empty object when accessed from Popup even
// though it definitely wasn't empty (log statements showed this), so need to all be in
// one file so that webpack doesn't mess up with imports.
// Note that before moving to this solution, I made sure there weren't any circular
// dependencies, but it didn't solve the issue.

// Another note: even though Segment and Group both use Popups, I didn't want to put
// Popup in TreeItem because I didn't want to hard-code `GroupOfGroups`s being expanded
// into `Group`s. In other words, it's
// possible someone may want to be able to move something to a `GroupOfGroups` (and
// therefore not expand the `GroupOfGroups`s into `Group`s within Popup), so didn't want
// to hard-code it into TreeItem. Probably better way to do this while still including
// Popup functionality in TreeItem?

import Picker from "vanilla-picker";

import { Attribute, Attributes } from "./Attribute.js";
import globals from "./globals.js";
import {
  arrowLeftIcon,
  arrowRightIcon,
  groupIcons,
  segmentIcons,
} from "./icon.js";
import IdCounter from "./IdCounter.js";
import { Actions, undoStorage } from "./UndoRedo.js";
import {
  compareProperty,
  getRandomColor,
  html,
  mappingToString,
  propertiesEqual,
  removeExtension,
  toggleButton,
} from "./util.js";

const media = globals.media;
const peaks = globals.peaks;
const basename = globals.basename;

// used with replaceAll, which requires global flag
// 1[2-9] matches 12-19, 2[0-4] matches 20-24, and 9312-9324 are circled numbers 1-15
// (only need 1-15 because rankSnrs only goes up to 15)
// I don't know if rankSnrs needed to use &#9312 instead of \u2460 (which would've
// made the regex simpler: /[\u2460-\u246F] ?/gu) but I'm keeping it just in case
const circleNumRegex = /&#93(1[2-9]|2[0-4]) ?/g;

const getMaxValueEntry = (countsMap) => {
  if (countsMap.size === 0) {
    throw Error("countsMap is empty");
  }
  const entries = [...countsMap.entries()];
  let [maxKey, maxCount] = entries.pop();
  for (const [key, count] of entries) {
    if (count > maxCount) {
      maxKey = key;
      maxCount = count;
    }
  }
  return [maxKey, maxCount];
};

// typedefs (used for JSDoc, can help explain types)
/**
 * A hex string in the form "#RRGGBB" that represents a color.
 * @typedef {string} Color
 */
/**
 * Object containing options for a Peaks segment.
 * @typedef {Object} PeaksSegmentOptions
 * @prop {number} startTime - The segment start time.
 * @prop {number} endTime - The segment end time.
 * @prop {boolean} [editable] - Whether the segment is editable.
 * @prop {Color} [color] - The segment color.
 * @prop {string} [labelText] - A text label displayed on hover over the segment.
 * @prop {string} [id] - The segment identifier.
 */

// instead of const use var so the classes hoist and
// can reference each other before definition
/**
 * An item in a tree.
 * Not intended to actually be used in the tree and instead acts as more of an
 * abstract class.
 */
var TreeItem = class TreeItem {
  // While I think actually using this class in the tree in addition to its
  // subclasses would work, TreeItem isn't intended to be used in the tree
  // and is more of an abstract class

  /**
   * An object containing `TreeItem` and its subclasses by their name.
   * The name of the class is the id, and the value is that class. For example,
   * `{ "TreeItem": TreeItem, "Group": Group, "Segment": Segment }`. When subclassing
   * `TreeItem`, be sure to add the subclass to this object.
   */
  // This is set at the bottom of the file
  static types = {};

  /**
   * An object containing all `TreeItem`s by their id.
   * Key is id, value is corresponding `TreeItem`:
   * {id: `TreeItem`}
   * @type {!Object.<string, TreeItem>}
   * @static
   */
  static byId = {};

  /**
   * HTML strings for the play, pause, loop, and remove icons for items in the tree.
   * @type {!Object.<string, string>}
   * @static
   */
  static icons = groupIcons;

  /**
   * Checks if a `TreeItem` by the given id exists.
   * @param {string} id - The id to check the existence of.
   * @returns {boolean} `true` if a TreeItem with `id` exists. Otherwise, `false`.
   * @static
   */
  static exists(id) {
    // in a static method, `this` refers to the class, e.g. TreeItem
    return id in this.byId;
  }

  static #excludedOpts = new Set(["children", "attributes"]);
  static #optsToSerialize = new Set(["childrenOptions", "moveTo", "copyTo"]);

  /**
   *
   * @param {Object} obj
   * @param {string} obj.type
   * @param {Array} obj.arguments
   * @param {!Object<string, *>} obj.options
   */
  static #extractChildrenOptions(obj) {
    if (!obj?.options?.children) {
      return obj; // no children to get options from, so return
    }

    const childrenOptions = obj.options.childrenOptions || {};

    const optCounts = {};
    obj.options.children.forEach((child) => {
      if (!child.options) {
        return;
      }
      Object.entries(child.options).forEach(([opt, val]) => {
        if (TreeItem.#excludedOpts.has(opt)) {
          return;
        }
        // for "childrenOptions", stringifying should be fine because properties of
        // the toObject result are added in specific order
        // stringifying "moveTo" and "copyTo" should work, but it's fine if it doesn't
        if (TreeItem.#optsToSerialize.has(opt)) {
          val = JSON.stringify(val);
        }
        if (typeof val === "object") {
          return;
        }
        let valCounts = optCounts[opt];
        if (!valCounts) {
          valCounts = new Map();
          optCounts[opt] = valCounts;
        }
        // using || is fine because if valCounts is 0, the right side is 0 anyway
        const count = valCounts.get(val) || 0;
        valCounts.set(val, count + 1);
      });
    });

    const childrenCount = obj.options.children.length;
    Object.entries(optCounts).forEach(([opt, valCounts]) => {
      if (valCounts.size === 0) {
        return;
      }
      const [mostUsedVal, useCount] = getMaxValueEntry(valCounts);
      if (useCount > childrenCount / 2) {
        childrenOptions[opt] = mostUsedVal;
      }
    });

    if (Object.keys(childrenOptions).length === 0) {
      return obj;
    }
    obj.options.childrenOptions = childrenOptions;
    // TODO: make this loop children and then childrenOptions instead of vice versa
    Object.entries(childrenOptions).forEach(([opt, val]) => {
      if (val === undefined) {
        // this could happen if some child's option is explicitly set to undefined
        return;
      }
      obj.options.children.forEach((child) => {
        if (!child.options) {
          // see below if statement
          child.options = { [opt]: undefined };
        }
        // we can ignore eslint because we know that child.options is a real object
        // eslint-disable-next-line no-prototype-builtins
        else if (!child.options.hasOwnProperty(opt)) {
          // if child is missing the option, we want to explicitly set it to undefined
          // so that it's not inherited from the parent
          child.options[opt] = undefined;
        } else if (child.options[opt] === val) {
          delete child.options[opt];
        } else if (TreeItem.#optsToSerialize.has(opt)) {
          // right now, val is still a JSON string, so convert child.options[opt] to
          // a JSON string to compare
          if (val === JSON.stringify(child.options[opt])) {
            delete child.options[opt];
          }
        }
      });
    });
    TreeItem.#optsToSerialize.forEach((opt) => {
      if (childrenOptions[opt]) {
        childrenOptions[opt] = JSON.parse(childrenOptions[opt]);
      }
    });

    return obj;
  }

  /**
   * The unique identifier of this item.
   * @type {string}
   */
  id;

  /**
   * The `TreeItem` that contains this item in its nested content.
   * `null` if this item is the root of the tree.
   * @type {?TreeItem}
   */
  #parent = null;

  /**
   * An array of `TreeItem`s contained in this item's nested content.
   * @type {!TreeItem[]}
   */
  children = [];

  /**
   * The text shown in `span` (and therefore in the tree).
   * This will still have a value if this item hasn't been rendered.
   * @type {string}
   */
  #text;

  /**
   * A `boolean` indicating if this item is checked / enabled.
   * This will still have a value if this item hasn't been rendered.
   * @type {boolean}
   */
  #checked = true;

  /**
   * A `boolean` indicating if this item can be played and looped.
   * @type {boolean}
   */
  playable;

  /**
   * How long this item's audio lasts in seconds if this item is playable.
   * Otherwise, `null`.
   * @type {?number}
   */
  duration = null;

  /**
   * A `boolean` indicating if this item can be removed from the tree.
   * @type {boolean}
   */
  removable;

  /**
   * A `boolean` indicating if this item can be renamed.
   * @type {boolean}
   */
  renamable;

  /**
   * An array of the `TreeItem`s that this item can be moved to.
   * `null` if this item isn't moveable.
   * Elements can also be arrays of `TreeItem`s. Then, when this item's `Popup` (if
   * it has one) is adding radio buttons for moving this item, it flattens `moveTo`
   * recursively. This is useful for situations like allowing an item to move
   * to any child of another `TreeItem` since the children of the `TreeItem` may
   * change.
   * For example, to make a `TreeItem` movable to any child of a `TreeItem` stored
   * in the variable `labeled`, you can add `labeled.children` to `moveTo`.
   * @type {?Array.<(TreeItem|TreeItem[])>}
   */
  moveTo = null;

  /**
   * An array of the `TreeItem`s that this item can be copied to.
   * `null` if this item isn't copyable.
   * Elements can also be arrays of `TreeItem`s.
   * @type {?Array.<(TreeItem|TreeItem[])>}
   * @see moveTo
   */
  copyTo = null;

  /**
   * An array of the `TreeItem`s that this item can be associated with.
   * `null` if this item isn't able to be associated.
   * The meaning of "associating" an item is up to subclasses if they decide to
   * use `assocWith`.
   * @type {?Array.<(TreeItem|TreeItem[])>}
   * @see moveTo
   */
  assocWith = null;

  /**
   * An object containing miscellaneous attributes of this item.
   * @type {?Object}
   */
  attributes = null;

  /**
   * A boolean indicating if the item is saveable.
   * If `true`, `toObject` will return an object containing the arguments and options
   * necessary to recreate the item. Otherwise, `toObject` will return `null`.
   * @type {boolean}
   */
  saveable;

  /**
   * The li element that is displayed and that contains all other elements if this
   * item is rendered. `null` otherwise.
   * @type {?HTMLLIElement}
   */
  li = null;

  /**
   * The input element of the checkbox used to toggle this item if this item is
   * rendered. `null` otherwise.
   * @type {?HTMLInputElement}
   */
  checkbox = null;

  /**
   * The span element containing the text shown in `li` if this item is rendered.
   * `null` otherwise.
   * @type {?HTMLSpanElement}
   */
  span = null;

  /**
   * The a element of the play button if this item is playable. Otherwise, `null`.
   * @type {?HTMLAnchorElement}
   */
  playButton = null;

  /**
   * The a element of the loop button if this item is playable. Otherwise, `null`.
   * @type {?HTMLAnchorElement}
   */
  loopButton = null;

  /**
   * The a element of the pause button if this item is playable. Otherwise, `null`.
   * The play and loop buttons are switched out with this when they're clicked,
   * so it's only displayed when the item is playing.
   * @type {?HTMLAnchorElement}
   */
  pauseButton = null;

  /**
   * The a element of the remove button.
   * `null` if this item isn't removable.
   * @type {?HTMLAnchorElement}
   */
  removeButton = null;

  /**
   * The `Popup` that is shown when this item (specifically `span`) is clicked.
   * `null` if this item doesn't have any properties shown in a `Popup`.
   * @type {?Popup}
   */
  popup = null;

  /**
   * The ul element containing the nested content (the children) of this item if
   * this item is rendered. `null` otherwise.
   * @type {?HTMLUListElement}
   */
  nested = null;

  /**
   * @param {string} id - The unique identifier to give the `TreeItem`.
   * @param {?Object.<string, any>=} options - Options to customize the `TreeItem`.
   * @param {?TreeItem=} options.parent - The `TreeItem` that contains the item in its
   *      nested content.
   * @param {?Array.<TreeItem>=} options.children - An array of `TreeItem`s to put in
   *      the item's nested content.
   * @param {string=} options.text - The text to show in the item's span (and therefore
   *      in the tree). If `null`, `id` is used.
   * @param {boolean} [options.playable=false] - Indicates if the item can be played
   *      and looped.
   * @param {boolean} [options.removable=false] - Indicates if the item can be removed
   *      from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the item can be renamed.
   * @param {?Array.<TreeItem>=} [options.moveTo] - An array of the `TreeItem`s
   *      that the item can be moved to. `null` if the item isn't moveable.
   * @param {?Array.<TreeItem>=} [options.copyTo] - An array of the `TreeItem`s
   *      that the item can be copied to. `null` if the item isn't copyable.
   * @param {?Array.<TreeItem>=} [options.assocWith] - An array of the `TreeItem`s
   *      that item can be associated with. `null` if the item isn't able to be
   *      associated.
   * @param {boolean} [options.render=true] - If `true`, `render()` is called in
   *      the constructor. Otherwise, `render()` is not called and is left to the
   *      user to call.
   * @param {?Object.<string, any>=} [options.attributes] - An object containing
   *     miscellaneous attributes of the item.
   * @param {boolean} [options.saveable=true] - Indicates if the item is saveable.
   *     If `true`, `toObject` will return an object containing the arguments and
   *     options necessary to recreate the item. Otherwise, `toObject` will return
   *     `null`.
   * @throws {Error} If a `TreeItem` with `id` already exists.
   */
  constructor(
    id,
    {
      parent = null,
      children = null,
      text = null,
      playable = false,
      removable = false,
      renamable = false,
      moveTo = null,
      copyTo = null,
      render = true,
      assocWith = null,
      attributes = null,
      saveable = true,
    } = {},
  ) {
    this.id = id;
    this.addToById();

    // this is a hack to make toObject work TODO: find a better way
    this.children.id = `${this.id}.children`;

    this.#text = text || id;
    this.playable = playable;
    this.duration = playable ? 0 : null;
    this.removable = removable;
    this.renamable = renamable;
    this.moveTo = moveTo;
    this.copyTo = copyTo;
    this.assocWith = assocWith;
    this.attributes = attributes;
    this.saveable = saveable;
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (Attributes[key] === undefined) {
          Attributes[key] = new Attribute(key, value, this.constructor.name);
        }
      }
    }

    if (render) {
      this.render();
    }

    if (parent) {
      if (parent instanceof Node && this.rendered) {
        parent.append(this.li);
      } else {
        parent.addChildren(this);
      }
    }

    if (children) {
      this.addChildren(...children);
    }
  }

  toObject() {
    if (!this.saveable) {
      return null;
    }
    const options = {};
    if (this.parent) {
      options.parent = this.parent.id;
    }
    if (this.children?.length) {
      const children = [];
      this.children.forEach((child) => {
        // not all children are guaranteed to define toObject(), hence the ?.()
        const childJson = child.toObject?.();
        if (childJson) {
          // remove the parent property from the child's json since it's redundant
          delete childJson.options.parent;
          children.push(childJson);
        }
      });
      if (children.length > 0) {
        options.children = children;
      }
    }
    if (this.text !== this.id) {
      options.text = this.text;
    }
    if (this.playable) {
      options.playable = true;
    }
    if (this.removable) {
      options.removable = true;
    }
    if (this.renamable) {
      options.renamable = true;
    }
    if (this.moveTo) {
      // FIXME: this doesn't work because some items in moveTo are arrays of TreeItems
      options.moveTo = this.moveTo.map((item) => item.id);
    }
    if (this.copyTo) {
      // FIXME: see above
      options.copyTo = this.copyTo.map((item) => item.id);
    }
    if (this.assocWith) {
      // FIXME: see above
      options.assocWith = this.assocWith.map((item) => item.id);
    }
    if (this.attributes) {
      options.attributes = this.attributes;
    }

    const json = {
      type: this.constructor.name,
      arguments: [this.id],
      options,
    };
    return TreeItem.#extractChildrenOptions(json);
  }

  // https://stackoverflow.com/a/68374307
  /**
   * Gets every constructor used to construct `this`.
   * In other words, gets `this`' class and all of its superclasses.
   * The order is from the closest superclass to the furthest, so the first element is
   * the class of `this` and the last element is the superclass before `Object`.
   * @return {!Array.<Object>} The constructors of `this`.
   */
  get constructors() {
    const result = [];
    let next = Object.getPrototypeOf(this);
    while (next.constructor.name !== "Object") {
      result.push(next.constructor);
      next = Object.getPrototypeOf(next);
    }
    return result;
  }

  /**
   * The `TreeItem` that contains this item in its nested content.
   * `null` if this item is the root of the tree.
   * @type {?TreeItem}
   */
  get parent() {
    return this.#parent;
  }
  set parent(parent) {
    parent.addChildren(this);
  }

  // We have to have a separate property for text instead of just using
  // span.innerHTML because span is null if !this.rendered
  /**
   * The text shown in (or would be) `span` (and therefore in the tree).
   * @type {string}
   */
  get text() {
    return this.#text;
  }
  set text(newText) {
    // setter for text so `this.text = newText` updates text in tree
    this.#text = newText;
    if (this.rendered) {
      this.span.innerHTML = newText;
    }
  }

  // we have to have a separate property for checked instead of just using
  // checkbox.checked because checkbox is null if !this.rendered
  /**
   * A `boolean` indicating if this item is checked / enabled.
   * @type {boolean}
   */
  get checked() {
    return this.#checked;
  }
  set checked(bool) {
    this.#checked = bool;
    if (this.rendered) {
      this.checkbox.checked = bool;
    }
  }

  /**
   * A `boolean` indicating if this item is rendered, i.e. if `this.render()` has
   * been called.
   * @type {boolean}
   */
  get rendered() {
    return this.li !== null;
  }

  /**
   * `null` if this item doesn't have a parent. Otherwise, an array containing this
   * item's parent, this item's parent's parent, etc. Top-most parents are first in
   * the array, with this item's parent being last. For example,
   * `[root, great-grandparent, grandparent, parent]`.
   * @type {?Array.<TreeItem>}
   */
  get ancestors() {
    if (this.parent) {
      const parentAncestors = this.parent.ancestors;
      if (parentAncestors) {
        parentAncestors.push(this.parent);
        return parentAncestors; // ancestors is parent's ancestors + parent
      }
      return [this.parent]; // parent has no ancestors, so ancestors is just parent
    }
    return null; // no parent, so no ancestors
  }

  /**
   * `null` if this item doesn't have a parent. Otherwise, an array containing this
   * item's parent's id, this item's parent's parent's id, etc. Top-most parents' ids
   * are first in the array, with this item's parent's id being last. For example,
   * `[root.id, great-grandparent.id, grandparent.id, parent.id]`.
   *
   * This is here for backwards compatibility with the database.
   * @type {?Array.<String>}
   */
  get path() {
    return this.ancestors?.map((ancestor) => ancestor.id);
  }

  *preorder(/** @type {?Array.<TreeItem>} */ exclude = null) {
    if (!exclude?.includes(this)) {
      yield this;
      for (const child of this.children) {
        yield* child.preorder(exclude);
      }
    }
  }

  /**
   * Adds `TreeItem`s to this `TreeItem`'s nested content.
   * @param  {...TreeItem} children - The children to add.
   */
  addChildren(...children) {
    for (const child of children) {
      if (child.parent) {
        child.parent.removeChildren(child);
      }
      child.#parent = this;
      this.children.push(child);
      if (this.rendered && child.rendered) {
        this.nested.append(child.li);
      }
      if (this.playable && child.playable) {
        this.updateDuration(child.duration);
      }
    }
  }

  /**
   * Removes `TreeItem`s from this `TreeItem`'s nested content.
   * @param  {...TreeItem} children - The children to remove.
   */
  removeChildren(...children) {
    const ids = children.map((child) => child.id);
    children.forEach((child) => {
      child.#parent = null;
      if (this.playable && child.playable) {
        this.updateDuration(-child.duration);
      }
    });
    this.children = this.children.filter((child) => !ids.includes(child.id));
  }

  /**
   * Adds play and loop buttons to this item.
   * This also sets `this.playable` to `true` and `this.duration` to 0.
   */
  makePlayable() {
    this.playable = true;
    this.duration = 0;

    if (this.rendered) {
      this.playButton = html`<a href="javascript:;" class="button-on"
        >${this.constructor.icons.play}</a
      >`;
      // use () => this.play() instead of just this.play so that
      // "this" refers to the TreeItem and not the button getting clicked
      this.playButton.addEventListener("click", () => this.play());
      // this puts the play button before any other buttons
      this.span.after(this.playButton);

      this.loopButton = html`<a href="javascript:;" class="button-on"
        >${this.constructor.icons.loop}</a
      >`;
      // need to use () => so that we can pass loop = true
      this.loopButton.addEventListener("click", () => this.play(true));
      this.playButton.after(this.loopButton);

      this.pauseButton = html`<a href="javascript:;" class="button-on"
        >${this.constructor.icons.pause}</a
      >`;
      this.pauseButton.addEventListener("click", () => this.pause());
    }
  }

  /**
   * Adds a remove button to this item.
   * This also sets `this.removable` to `true`.
   */
  makeRemovable() {
    this.removable = true;

    if (this.rendered) {
      this.removeButton = html`<a href="javascript:;" class="button-on"
        >${this.constructor.icons.remove}</a
      >`;
      this.removeButton.addEventListener("click", () => {
        undoStorage.push(new Actions.RemoveAction(this));
      });
      // this puts the remove button after any other buttons
      this.nested.before(this.removeButton);
    }
  }

  /** Generates the HTML for this item. */
  render() {
    if (this.li) {
      this.li.remove();
    }

    // since subclasses use this method, use this.constructor.icons to use the icons of
    // whatever class is being initialized (i.e. Group, TreeItem, Segment, etc.)
    const li = html`<li>
      <input type="checkbox" autocomplete="off" checked />
      <span>${this.#text}</span>
      <ul class="nested active"></ul>
    </li>`;
    this.li = li;

    this.checkbox = li.children[0];
    // event listeners need to use `() => {}` syntax instead of `function () {}` because
    // `() => {}` doesn't rebind `this` (`this` will still refer to the TreeItem)
    this.checkbox.addEventListener("click", () => {
      this.toggle();
    });
    // on right click
    const contextMenu = document.getElementById("checkbox-contextmenu");
    this.checkbox.addEventListener("contextmenu", (event) => {
      // prevent default so that the right click context menu doesn't show
      event.preventDefault();

      const { clientX: mouseX, clientY: mouseY } = event;

      contextMenu.style.top = `${mouseY}px`;
      contextMenu.style.left = `${mouseX}px`;

      contextMenu.style.display = "block";
      // set "data-id" to the id of the TreeItem that was right clicked to check later
      contextMenu.dataset.id = this.id;
    });

    this.span = li.children[1];
    // need to track mousemove to know if we want to
    // drag a segment or click it for popup
    // TODO: give some wiggle room before drag is considered true
    let drag = false;
    this.span.addEventListener("mousedown", () => (drag = false));
    this.span.addEventListener("mousemove", () => (drag = true));
    this.span.addEventListener("mouseup", () => {
      // TODO: move popup to TreeItem constructor?
      if (this.popup && drag === false) {
        this.popup.show();
      }
    });

    this.updateSpanTitle();

    this.nested = li.children[2];

    if (this.playable) {
      this.makePlayable();
    }
    if (this.removable) {
      this.makeRemovable();
    }

    // this is here for subclasses to define a style method
    // if they want to apply specific CSS styles
    this.style?.();
  }

  /**
   * Updates `duration`.
   * @param {number} durationChange - The amount to change `duration` by. If negative,
   *      decreases `duration`. Otherwise, increases `duration`.
   */
  updateDuration(durationChange) {
    if (this.playable) {
      this.duration = this.duration + durationChange;
      if (this.rendered) {
        this.updateSpanTitle();
      }

      if (this.parent) {
        this.parent.updateDuration(durationChange);
      }
    }
  }

  /** Updates the title (tooltip) of `span`. */
  updateSpanTitle() {
    if (!this.rendered) {
      // maybe this should throw an error instead?
      return; // there's no span if this item hasn't been rendered
    }
    if (this.playable && this.duration != 0) {
      this.span.title = `Duration: ${this.duration.toFixed(2)}`;
    }
    // in case a playable group had its last playable child removed,
    // in which case we don't want a span title anymore
    else {
      this.span.title = "";
    }
  }

  /**
   * Switches this item's play or loop button with its pause button.
   * @param {boolean} loop - If `true`, the loop button is replaced. Otherwise,
   *      the play button is replaced.
   * @throws {Error} If this item is not playable.
   */
  switchToPauseButton(loop) {
    if (!this.rendered) {
      throw new Error(
        `TreeItem ${this.id} is not rendered and therefore has no buttons to switch.`,
      );
    }
    if (!this.playable) {
      throw new Error(
        `TreeItem ${this.id} is not playable and therefore has no buttons to switch.`,
      );
    }
    if (loop) {
      this.loopButton.replaceWith(this.pauseButton);
    } else {
      this.playButton.replaceWith(this.pauseButton);
    }
  }

  /**
   * Switches the pause button (if currently visible) with the button it replaced.
   * @throws {Error} If this item is not playable.
   */
  switchBackToPlayLoopButtons() {
    if (!this.rendered) {
      throw new Error(
        `TreeItem ${this.id} is not rendered and therefore has no buttons to switch.`,
      );
    }
    if (!this.playable) {
      throw new Error(
        `TreeItem ${this.id} is not playable and therefore has no buttons to switch.`,
      );
    }
    if (this.playButton.parentElement === null) {
      this.pauseButton.replaceWith(this.playButton);
    } else if (this.loopButton.parentElement === null) {
      this.pauseButton.replaceWith(this.loopButton);
    }
  }

  /**
   * Adds this item's id to its class' and all of its superclasses' `byId` fields.
   * @throws {Error} If a `TreeItem` with `id` already exists in `byId`.
   */
  addToById() {
    if (TreeItem.exists(this.id)) {
      throw new Error(`A TreeItem with the id ${this.id} already exists.`);
    }
    this.constructors.forEach((ctor) => (ctor.byId[this.id] = this));
  }

  /**
   * Removes this item's id from its class' and all of its superclasses' `byId` fields.
   */
  removeFromById() {
    this.constructors.forEach((ctor) => delete ctor.byId[this.id]);
  }

  /**
   * Removes this item and all of its children from the tree.
   * @throws {Error} If this item cannot be removed.
   */
  remove() {
    if (!this.removable) {
      throw new Error(`TreeItem ${this.id} is not removable.`);
    }
    if (this.rendered) {
      this.li.remove();
      this.li = null;
    }
    this.removeFromById();
    this.children.forEach((child) => child.remove());
    if (this.parent) {
      this.parent.removeChildren(this);
    }
  }

  /**
   * Readds this item.
   * To be specific, adds this item to `byId` and `parent` if not `null`. If `parent`
   * is `null` and `this.parent` isn't, `this.parent` is used instead. Otherwise, if
   * both are `null`, this item isn't added to any parent.
   * @param {?TreeItem} parent - The `TreeItem` to add this item to, if any.
   * @param {boolean} [render=true] - Whether to render this item after readding it.
   */
  readd(parent = null, render = true) {
    this.addToById(); // will throw an error if one already exists !
    if (render) {
      this.render();
    }
    if (parent !== null) {
      parent.addChildren(this);
    } else if (this.parent !== null) {
      this.parent.addChildren(this);
    }
  }

  /**
   * Moves this tree item to another item's nested content.
   * @param {!TreeItem} to - Where to move this item to.
   * @param {boolean} [open=true] - Whether to open `to`'s nested content after moving
   *      this item to it.
   */
  move(to, open = true) {
    to.addChildren(this);
    if (open) {
      to.open();
    }
  }

  /**
   * Renames this item, replacing its id and text in the tree.
   * @param {string} newId - The new id to give this item.
   * @throws {Error} If this item cannot be renamed.
   * @throws {Error} If a `TreeItem` with `newId` already exists.
   */
  rename(newId) {
    if (!this.renamable) {
      throw new Error(`TreeItem ${this.id} is not renamable.`);
    }
    // check even though it's checked in addToById because otherwise if
    // that throws an error, removeFromById will still have already run
    if (TreeItem.exists(newId)) {
      throw new Error(`A TreeItem with the id ${newId} already exists`);
    }
    // delete the old name from the byId objects
    this.removeFromById();
    this.id = newId;
    // add the new name to the byId objects
    this.addToById();
    this.text = newId;
  }

  /**
   * Sorts this item's children in the tree by a property.
   * @param {string} prop - The property to sort by.
   * @param {Object} options - The options for sorting.
   * @param {boolean} [options.reverse=false] - Whether to reverse the order of the
   *   children after sorting them.
   * @param {boolean} [options.reappend=true] - Whether to reappend the children to
   *   this' `li` so that the elements are in the sorted order. Only applies if
   *   this item is rendered and only applies to the children that are rendered.
   * @returns {TreeItem[]} The reference to this item's children, now sorted.
   */
  sortBy(prop, { reverse = false, reappend = true } = {}) {
    return this.sort(
      (child1, child2) => compareProperty(child1, child2, prop),
      { reverse, reappend },
    );
  }

  /**
   * Sorts this item's children in the tree.
   * @param {function} compareFn - The function to use to compare the children.
   * @param {Object} options - The options for sorting.
   * @param {boolean} [options.reverse=false] - Whether to reverse the order of the
   *    children after sorting them.
   * @param {boolean} [options.reappend=true] - Whether to reappend the children to
   *     this' `li` so that the elements are in the sorted order. Only applies if
   *     this item is rendered and only applies to the children that are rendered.
   * @returns {TreeItem[]} The reference to this item's children, now sorted.
   */
  sort(compareFn, { reverse = false, reappend = true } = {}) {
    this.children.sort(compareFn);
    if (reverse) {
      this.children.reverse();
    }
    if (this.rendered && reappend) {
      this.children
        .filter((child) => child.rendered)
        .forEach((child) => this.nested.append(child.li));
    }
    return this.children;
  }

  /**
   * Toggles this item's elements on / off.
   * Toggling on / off does the following:
   *  - Checks / unchecks `checkbox`.
   *  - Hides / unhides this item's nested content.
   *  - Makes `playButton`, `loopButton` and `removeButton` clickable / unclickable.
   *  - Colors `playButton`, `loopButton` and `removeButton` black / gray.
   * @param {boolean=} force - If unspecified, this item is always toggled. Otherwise,
   *      this item is only toggled if its current state isn't equal to `force`.
   * @returns {boolean} A `boolean` indiciating if any toggling was done.
   *      In other words, when `force == null`, returns `true`. Otherwise,
   *      returns `force !== checked`.
   */
  toggleTree(force = null) {
    if (force === this.checked) {
      return false;
    }

    // force must equal !this.checked at this point so just use !this.checked
    this.checked = !this.checked;

    if (this.rendered) {
      this.nested.classList.toggle("active", this.checked);

      if (this.playButton) {
        toggleButton(this.playButton, this.checked);
        toggleButton(this.loopButton, this.checked);
      }
      if (this.removeButton) {
        toggleButton(this.removeButton, this.checked);
      }
    }

    return true;
  }

  /**
   * Toggles this item on / off.
   * This is an alias for `toggleTree`.
   * @see toggleTree
   */
  toggle(force = null) {
    return this.toggleTree(force);
  }

  /**
   * Opens (unhides) this item's nested content and the nested content of each item in
   * `path`. This doesn't toggle any of the items; it only opens the tree along `path`.
   */
  open() {
    if (this.rendered) {
      this.nested.classList.add("active");
      this.checked = true;
      if (this.parent) {
        this.parent.open();
      }
    }
  }

  /**
   * Takes in the id of a TreeItem that could be a immediate/distant child
   * and returns if it does or doesn't have it as a child
   * @param {string} childId
   * @returns whether this TreeItem has that child somewhere underneath it
   */
  hasChild(childId) {
    let hasChild = false;
    const potentialParent = TreeItem.byId[this.id];
    potentialParent.children.forEach((child) => {
      // base case
      if (child.id === childId) hasChild = true;
      // step case
      else if (child.hasChild(childId)) hasChild = true;
    });
    return hasChild;
  }

  /**
   * Opens the tree and scrolls this item into view, making it visible to the user.
   *
   * @param {boolean} [highlight=true] - Whether to highlight this item after scrolling.
   *     Highlighting adds a blue border around the item temporarily.
   */
  scrollIntoView(highlight = true) {
    this.open();
    this.li.scrollIntoView({ block: "center" });
    if (highlight) {
      this.li.classList.add("highlight");
      setTimeout(() => this.li.classList.remove("highlight"), 2000);
    }
  }

  // FIXME: make events work even if this item hasn't been rendered
  // The following 3 methods implement the EventTarget interface
  // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget
  /**
   * Sets up a function that will be called whenever the specified event is
   * delivered to the target.
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener EventTarget.addEventListener}
   */
  addEventListener(type, listener, options) {
    this.li.addEventListener(type, listener, options);
  }

  /**
   * Removes an event listener previously registered with `addEventListener`
   * from the target.
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener EventTarget.removeEventListener}
   */
  removeEventListener(type, listener, options) {
    this.li.removeEventListener(type, listener, options);
  }

  /**
   * Sends an `Event` to this item, invoking the affected `EventListeners`.
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/dispatchEvent EventTarget.dispatchEvent}
   */
  dispatchEvent(event) {
    return this.li.dispatchEvent(event);
  }
};

/** A popup to display when a `TreeItem` is clicked. */
var Popup = class Popup {
  /**
   * The `TreeItem` that uses this popup.
   * Properties of `treeItem` are used to determine the contents of this popup.
   * @type {!TreeItem}
   */
  treeItem;

  /**
   * The text shown in the headers of this popup's divs.
   * Always equals `treeItem.text`.
   * @type {string}
   */
  #text;

  /**
   * The div element that contains all other elements.
   * Displayed when `treeItem` is clicked (and this popup currently has content).
   * @type {!HTMLDivElement}
   */
  popup;

  // Honestly I'm not sure why popup and popupContent are separate, that's just the way
  // Sarita made it, so that's how I made the class. They might be able to be combined
  /**
   * The div element containing the actual content of the popup.
   * @type {!HTMLDivElement}
   */
  popupContent;

  /**
   * The div element containing `renameInput` if `treeItem.renamable`.
   * Otherwise, `null`.
   * @type {?HTMLDivElement}
   */
  renameDiv = null;

  /**
   * The text input element used to rename `treeItem` if `treeItem.renamable`.
   * Otherwise, `null`.
   * @type {?HTMLInputElement}
   */
  renameInput = null;

  /**
   * The div element containing the radio buttons used to move `treeItem`
   * if `treeItem.moveTo`. Otherwise, `null`.
   * @type {?HTMLDivElement}
   */
  moveDiv = null;

  /**
   * The div element containing the radio buttons used to copy `treeItem`
   * if `treeItem.copyTo`. Otherwise, `null`.
   * @type {?HTMLDivElement}
   */
  copyDiv = null;

  /**
   * The div element containing the radio buttons used to associate
   * `treeItem` if `treeItem.assocWith`.
   * Otherwise, `null`.
   * @type {?HTMLDivElement}
   */
  assocDiv = null;

  /**
   * The div element containing `colorPicker` if `treeItem.colorable`.
   * Otherwise, `null`.
   * @type {?HTMLDivElement}
   */
  colorDiv = null;

  /**
   * The color picker used to set the color of `treeItem` if `treeItem.colorable`.
   * Otherwise, `null`.
   * @type {?Picker}
   */
  colorPicker = null;

  /**
   * The button element used to set `treeItem` to a random color if
   * `treeItem.colorable`. Otherwise, `null`.
   * @type {?HTMLButtonElement}
   */
  randomColorButton = null;

  /**
   * @param {!TreeItem} treeItem - The `TreeItem` to create the `Popup` for.
   */
  constructor(treeItem) {
    this.popup = html`<div class="popup"></div>`;

    const popupContent = html`<div class="popup-content"></div>`;
    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);

    this.treeItem = treeItem;
    treeItem.li.append(this.popup);

    const text = treeItem.text;
    this.#text = text; // set this.#text and not this.text so it doesn't call setter

    const closeButton = html`<a class="close">&times</a>`;
    popupContent.appendChild(closeButton);
    closeButton.addEventListener("click", () => this.hide());

    if (treeItem.renamable) {
      const renameDiv = html`<div><h3>Rename ${text}</h3></div>`;
      this.renameDiv = renameDiv;
      const renameInput = html`<input type="text" value="${text}" />`;
      this.renameInput = renameInput;
      renameDiv.append(renameInput);
      renameInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          undoStorage.push(
            new Actions.RenameAction(treeItem, renameInput.value),
          );
          this.hide();
        }
      });
      popupContent.append(renameDiv);
    }

    if (treeItem.moveTo) {
      popupContent.append(document.createElement("br"));
      this.moveDiv = html`<div><h3>Move ${text} to another group</h3></div>`;
      popupContent.append(this.moveDiv);
    }

    if (treeItem.copyTo) {
      popupContent.append(document.createElement("br"));
      this.copyDiv = html`<div><h3>Copy ${text} to another group</h3></div>`;
      popupContent.append(this.copyDiv);
    }

    if (treeItem.assocWith) {
      popupContent.append(document.createElement("br"));
      this.assocDiv = html`<div>
        <h3>Associate ${text} with a speaker</h3>
      </div>`;
      popupContent.append(this.assocDiv);
    }

    if (treeItem.colorable) {
      const colorDiv = html`<div><h3>Pick a new color for ${text}</h3></div>`;
      this.colorDiv = colorDiv;
      const colorPicker = new Picker({
        parent: colorDiv,
        popup: false,
        alpha: false,
      });
      this.colorPicker = colorPicker;
      colorPicker.onDone = (color) => {
        undoStorage.push(
          new Actions.ColorAction(treeItem, color.hex.substring(0, 7)),
        );
        this.hide();
      };

      const randomColorButton = html`<button>Set to random color</button>`;
      this.randomColorButton = randomColorButton;
      colorDiv.append(randomColorButton);
      randomColorButton.addEventListener("click", () => {
        const randomColor = getRandomColor();
        undoStorage.push(new Actions.ColorAction(treeItem, randomColor));
        this.colorPicker.setColor(randomColor, true);
      });

      popupContent.append(colorDiv);
    }
  }

  /**
   * The text shown in the headers of this popup's divs.
   * Always equals `treeItem.text`.
   * @type {string}
   */
  get text() {
    return this.#text;
  }
  set text(newText) {
    this.#text = newText;
    if (this.renameDiv) {
      this.renameDiv.firstElementChild.innerHTML = `Rename ${newText}`;
    }
    if (this.moveDiv) {
      this.moveDiv.firstElementChild.innerHTML = `Move ${newText} to another group`;
    }
    if (this.copyDiv) {
      this.copyDiv.firstElementChild.innerHTML = `Copy ${newText} to another group`;
    }
    if (this.assocDiv) {
      this.assocDiv.firstElementChild.innerHTML = `Associate ${newText} with a speaker`;
    }
    if (this.colorDiv) {
      this.colorDiv.firstElementChild.innerHTML = `Pick a new color for ${newText}`;
    }
  }

  /** Updates content and displays this popup. */
  show() {
    if (this.text !== this.treeItem.text) {
      this.text = this.treeItem.text;
    }
    if (this.moveDiv) {
      this.updateMoveTo();
    }
    if (this.copyDiv) {
      this.updateCopyTo();
    }
    if (this.assocDiv) {
      this.updateAssocWith();
    }
    if (this.colorPicker) {
      this.colorPicker.setColor(this.treeItem.color || "#000000", true);
    }
    if (
      this.renameDiv ||
      // can't use !this?.moveDiv?.hidden because if moveDiv is
      // undefined, it'll evalute to true (!undefined == true)
      (this.moveDiv && !this.moveDiv.hidden) ||
      (this.copyDiv && !this.copyDiv.hidden) ||
      (this.assocDiv && !this.assocDiv.hidden) ||
      this.colorDiv
    ) {
      this.popup.style.display = "block";
    }
  }

  /** Hides this popup. */
  hide() {
    this.popup.style.display = "none";
  }

  /**
   * Updates the radio buttons in `moveDiv`.
   * This adds buttons for new `TreeItem`s that `treeItem` can be moved to
   * and removes buttons for `TreeItem`s that it can't be moved to anymore.
   */
  updateMoveTo() {
    const moveDiv = this.moveDiv;
    // remove all of the current divs
    // moveDiv.children[0] is the heading so don't remove that one
    while (moveDiv.children[1]) {
      moveDiv.removeChild(moveDiv.lastChild);
    }
    // flatten until all subarrays have been flattened
    // see TreeItem.moveTo for why this is useful
    let moveTo = this.treeItem.moveTo.flat(Infinity);
    if (this.treeItem.parent !== null) {
      moveTo = moveTo.filter((dest) => dest.id !== this.treeItem.parent.id);
    }
    moveDiv.hidden = moveTo.length === 0;
    moveTo.forEach((dest) => this.addMoveRadio(dest));
  }

  /**
   * Updates the radio buttons in `copyDiv`.
   * This adds buttons for new `TreeItem`s that `treeItem` can be copied to
   * and removes buttons for `TreeItem`s that it can't be copied to anymore.
   */
  updateCopyTo() {
    const copyDiv = this.copyDiv;
    while (copyDiv.children[1]) {
      copyDiv.removeChild(copyDiv.lastChild);
    }
    let copyTo = this.treeItem.copyTo.flat(Infinity);
    if (this.treeItem.parent !== null) {
      copyTo = copyTo.filter((dest) => dest.id !== this.treeItem.parent.id);
    }
    copyDiv.hidden = copyTo.length === 0;
    copyTo.forEach((dest) => this.addCopyRadio(dest));
  }
  /**
   * Updates the radio buttons in `assocDiv`.
   * This adds buttons for new `TreeItem`s that `Face` can be associated with.
   */
  updateAssocWith() {
    const assocDiv = this.assocDiv;
    while (assocDiv.children[1]) {
      assocDiv.removeChild(assocDiv.lastChild);
    }
    const assocWith = this.treeItem.assocWith.flat(Infinity);
    assocDiv.hidden = assocWith.length === 0;
    assocWith.forEach((dest) => {
      if (dest.faceNum === null) {
        this.addAssocRadio(dest);
      }
    });
  }

  /**
   * Adds a radio button used to move `treeItem`.
   * @param {!TreeItem} dest - The `TreeItem` to move `treeItem` to when the radio
   *      button is clicked.
   */
  addMoveRadio(dest) {
    const radioDiv = html`<div>
      <label>
        <input
          type="radio"
          name="${this.treeItem.id}-radios"
          autocomplete="off"
        />
        ${dest.id}
      </label>
      <br />
    </div>`;
    const radioButton = radioDiv.firstElementChild.firstElementChild;

    this.moveDiv.append(radioDiv);

    radioButton.addEventListener("change", () => {
      undoStorage.push(new Actions.MoveAction(this.treeItem, dest));
      radioButton.checked = false;
      this.hide();
    });
  }

  /**
   * Adds a radio button used to copy `treeItem`.
   * @param {!TreeItem} dest - The `TreeItem` to copy `treeItem` to when the radio
   *      button is clicked.
   */
  addCopyRadio(dest) {
    const radioDiv = html`<div>
      <label>
        <input
          type="radio"
          name="${this.treeItem.id}-radios"
          autocomplete="off"
        />
        ${dest.id}
      </label>
      <br />
    </div>`;
    const radioButton = radioDiv.firstElementChild.firstElementChild;

    this.copyDiv.append(radioDiv);

    radioButton.addEventListener("change", () => {
      const copied = this.treeItem.copy(dest);
      if (copied) {
        undoStorage.push(new Actions.CopyAction(copied));
        dest.sortBy("startTime");
      }
      dest.open();
      radioButton.checked = false;
      this.hide();
    });
  }

  /**
   * Adds a radio button used to associate the `Face` with a `TreeItem`.
   * @param {!TreeItem} dest - The `TreeItem` to associate the `Face` to
   *      when the radio button is clicked.
   */
  addAssocRadio(dest) {
    const radioDiv = html`<div>
      <label>
        <input
          type="radio"
          name="${this.treeItem.id}-radios"
          autocomplete="off"
        />
        ${dest.id}
      </label>
      <br />
    </div>`;
    const radioButton = radioDiv.firstElementChild.firstElementChild;

    this.assocDiv.append(radioDiv);

    radioButton.addEventListener("change", () => {
      undoStorage.push(new Actions.AssociateAction(this.treeItem, dest));
      radioButton.checked = false;
      this.hide();
    });
  }
};

/**
 * A group of `TreeItem`s.
 * @extends TreeItem
 */
var Group = class Group extends TreeItem {
  /**
   * An object containing all `Group`s by their id.
   * Key is id, value is corresponding `Group`:
   * {id: `Group`}
   * @type {!Object.<string, Group>}
   * @static
   */
  static byId = {};

  /**
   * HTML strings for the play, pause, loop, and remove icons for `Group`s
   * in the tree.
   * @type {!Object.<string, string>}
   * @static
   */
  static icons = groupIcons;

  /**
   * @param {string} id - The unique identifier to give the `Group`.
   * @param {?Object.<string, any>=} options - Options to customize the group.
   * @param {?TreeItem=} options.parent - The `TreeItem` that contains the
   *      group in its nested content.
   * @param {?Array.<TreeItem>=} options.children - An array of `TreeItem`s to put in
   *      the group's nested content.
   * @param {string=} options.text - The text to show in the group's span (and
   *      therefore in the tree). If `null`, `id` is used.
   * @param {boolean} [options.playable=false] - Indicates if the group can be played
   *      and looped.
   * @param {boolean} [options.removable=false] - Indicates if the group can be removed
   *      from the tree.
   * @param {?Array.<TreeItem>=} [options.moveTo] - An array of the `TreeItem`s
   *      that the group can be moved to. `null` if the group isn't moveable.
   * @param {?Array.<TreeItem>=} [options.copyTo] - An array of the `TreeItem`s
   *      that the group can be copied to. `null` if the group isn't copyable.
   * @throws {Error} If a `TreeItem` with `id` already exists.
   */
  constructor(
    id,
    {
      parent = null,
      children = null,
      text = null,
      playable = false,
      removable = false,
      moveTo = null,
      copyTo = null,
      saveable = true,
    } = {},
  ) {
    super(id, {
      parent,
      children,
      text,
      playable,
      removable,
      moveTo,
      copyTo,
      saveable,
    });
  }

  /** Sets the CSS styling of the group's elements. */
  style() {
    if (this.rendered) {
      this.li.style.fontSize = "18px";
    }
  }

  /**
   * Toggles this group and its children on / off.
   * @param {boolean=} force - If unspecified, this group is always toggled. Otherwise,
   *      this group is only toggled if its current state isn't equal to `force`.
   * @returns {boolean} A `boolean` indiciating if any toggling was done.
   *      In other words, when `force == null`, returns `true`. Otherwise,
   *      returns `force !== checked`.
   * @see toggleTree
   */
  toggle(force = null) {
    if (!this.toggleTree(force)) {
      return false;
    } // no toggling necessary
    // this.checked will be changed by toggleTree
    this.children.forEach((child) => child.toggle(this.checked));
    return true;
  }

  /**
   * Generates this group's children that are checked and playable.
   * The children are yielded in chronological order.
   * @param {boolean} infinite - If `true`, reaching the end of the children will
   *      restart from the beginning.
   * @yields {TreeItem} A `TreeItem` whose `checked` and `playable` properties are
   *      both `true`.
   */
  *checkedPlayableGenerator(infinite = false) {
    // do... while always executes the loop once and THEN evalutes the condition,
    // meaning all of the children that are checked will be yielded once, and then
    // if we are infinite, they will continue to be yielded forever
    //
    // since generators only calculate values when asked for them, if a user checks
    // a segment before it is reached by the generator, it will get included, even
    // though it wasn't checked when checkedGenerator was initially called
    do {
      // get children inside the loop because user may have added / removed children
      const children = [...this.sortBy("startTime")];
      if (children.length === 0) {
        // there's nothing to play, so stop the iterator completely using return
        // return will set the done property of generator.next() to true
        return;
      }
      for (const child of children) {
        // only yield checked, playable children because those are the only ones
        // that can be played
        if (child.checked && child.playable) {
          yield child;
        }
      }
    } while (infinite);
  }

  /**
   * If this group is playable, plays each checked, playable child belonging to this
   * group in chronological order.
   * @param {boolean} [loop=false] - If `true`, loops the children (reaching the end
   *      of the children will restart playing at the beginning)
   * @throws {Error} If this group is not playable.
   */
  play(loop = false) {
    if (!this.playable) {
      throw new Error(`Group ${this.id} is not playable.`);
    }

    // pause in case anything else is playing so that
    // their icons get switched back to play and loop
    media.pause();

    const checkedChildren = this.checkedPlayableGenerator(loop);
    let { value, done } = checkedChildren.next();
    const endedHandler = (event) => {
      // brackets are required if destructuring {} with pre-defined variables
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment#syntax
      ({ value, done } = checkedChildren.next());
      if (!done) {
        value.play();
        // if it propagates, parents will think this group has ended playback
        event.stopPropagation();
      } else {
        this.switchBackToPlayLoopButtons();
        this.removeEventListener("ended", endedHandler);
        // don't stopProgagation here because we can just let the
        // event propagate to indicate this group has ended instead
        // of needing to create a whole new event
      }
    };

    if (!done) {
      this.switchToPauseButton(loop);
      value.play();
      this.addEventListener("ended", endedHandler);

      this.addEventListener(
        "manualpause",
        () => {
          media.pause();
          this.switchBackToPlayLoopButtons();
          this.removeEventListener("ended", endedHandler);
        },
        { once: true },
      );
    }
  }

  /**
   * Pauses playback of this group if it is playing.
   * @throws {Error}
   */
  pause() {
    if (!this.playable) {
      throw new Error(
        `Group ${this.id} is not playable and therefore can't be paused.`,
      );
    }

    // dispatch manualpause to let the event listener added in play handle pausing
    // this way, the endedHandler can be removed (we couldn't do it here because
    // it's not defined here)
    this.dispatchEvent(new Event("manualpause", { bubbles: true }));
  }
};

var CarouselGroup = class CarouselGroup extends Group {
  /**
   * An object containing all `CarouselGroup`s by their id.
   * Key is id, value is corresponding `CarouselGroup`:
   * {id: `CarouselGroup`}
   * @type {!Object.<string, CarouselGroup>}
   */
  static byId = {};

  /**
   * The a element used to untoggle the currently selected item in the group and
   * toggle the item to its left in `children`.
   * If the currently selected item is the first item in `children`, the last item in
   * `children` is selected. If multiple items are selected, the first selected item is
   * used. If there are no items in `children` or no items are selected, nothing
   * happens.
   * @type {!HTMLAnchorElement}
   */
  leftButton;

  /**
   * The a element used to untoggle the currently selected item in the group and
   * toggle the item to its right in `children`.
   * If the currently selected item is the last item in `children`, the first item in
   * `children` is selected. If multiple items are selected, the first selected item is
   * used. If there are no items in `children` or no items are selected, nothing
   * happens.
   * @type {!HTMLAnchorElement}
   */
  rightButton;

  /**
   * @param {string} id - The unique identifier to give the `CarouselGroup`.
   * @param {?Object.<string, any>=} options - Options to customize the group.
   * @param {?TreeItem=} options.parent - The `TreeItem` that contains the
   *      group in its nested content.
   * @param {?Array.<TreeItem>=} options.children - An array of `TreeItem`s to put in
   *      the group's nested content.
   * @param {string=} options.text - The text to show in the group's span (and
   *      therefore in the tree). If `null`, `id` is used.
   * @param {boolean} [options.playable=false] - Indicates if the group can be played
   *      and looped.
   * @param {boolean} [options.removable=false] - Indicates if the group can be removed
   *      from the tree.
   * @param {?Array.<TreeItem>=} [options.moveTo] - An array of the `TreeItem`s
   *      that the group can be moved to. `null` if the group isn't moveable.
   * @param {?Array.<TreeItem>=} [options.copyTo] - An array of the `TreeItem`s
   *      that the group can be copied to. `null` if the group isn't copyable.
   * @throws {Error} If a `TreeItem` with `id` already exists.
   */
  constructor(
    id,
    {
      parent = null,
      children = null,
      text = null,
      playable = false,
      removable = false,
      moveTo = null,
      copyTo = null,
      saveable = true,
    } = {},
  ) {
    super(id, {
      parent,
      children,
      text,
      playable,
      removable,
      moveTo,
      copyTo,
      saveable,
    });
    this.leftButton = html`<a href="javascript:;" class="button-on"
      >${arrowLeftIcon}</a
    >`;
    // this puts the left button before any other buttons
    this.span.after(this.leftButton);
    this.leftButton.addEventListener("click", () => {
      const currentIndex = this.children.findIndex((child) => child.checked);
      const leftIndex = currentIndex - 1;
      // .at() to wrap around to the last index if leftIndex is -1
      this.children.at(leftIndex).openFile();
    });
    this.rightButton = html`<a href="javascript:;" class="button-on"
      >${arrowRightIcon}</a
    >`;
    this.leftButton.after(this.rightButton);
    this.rightButton.addEventListener("click", () => {
      const currentIndex = this.children.findIndex((child) => child.checked);
      // if currentIndex is the last index, this will wrap around to 0
      const rightIndex = (currentIndex + 1) % this.children.length;
      this.children.at(rightIndex).openFile();
    });
  }
};

/**
 * A `TreeItem` for a Peaks.js class (segment / point).
 * @extends TreeItem
 */
var PeaksItem = class PeaksItem extends TreeItem {
  /**
   * An object containing all `PeaksItem`s by their id.
   * Key is id, value is corresponding `PeaksItem`:
   * {id: `PeaksItem`}
   * @type {!Object.<string, PeaksItem>}
   * @static
   */
  static byId = {};

  /**
   * HTML strings for the play, pause, loop, and
   * remove icons for `PeaksItem`s in the tree.
   * @type {!Object.<string, string>}
   * @static
   */
  static icons = segmentIcons;

  /**
   * Gets the `PeaksSegment`s from the `PeaksItem`s that wrap `PeaksSegment`s.
   * @param {!Array.<PeaksItem>} peaksItems - The `PeaksItem`s to filter.
   * @returns {!Array.<PeaksSegment>} The `PeaksSegments`s in `peaksItem`s.
   */
  static getSegments(peaksItems) {
    const segments = [];
    peaksItems.forEach((peaksItem) => {
      if (peaksItem.type === "Segment") {
        segments.push(peaksItem.segment);
      }
    });
    return segments;
  }

  /**
   * Gets the `PeaksPoint`s from the `PeaksItem`s that wrap `PeaksPoint`s.
   * @param {!Array.<PeaksItem>} peaksItems - The `PeaksItem`s to filter.
   * @returns {!Array.<PeaksPoint>} The `PeaksPoints`s in `peaksItem`s.
   */
  static getPoints(peaksItems) {
    const points = [];
    peaksItems.forEach((peaksItem) => {
      if (peaksItem.type === "Point") {
        points.push(peaksItem.point);
      }
    });
    return points;
  }

  /**
   * Adds each item to Peaks.js, displaying it on the waveform.
   * @param {!Array.<PeaksItem>} peaksItems - The `PeaksItem`s to show.
   */
  static showOnPeaks(peaksItems) {
    const segments = PeaksItem.getSegments(peaksItems);
    const points = PeaksItem.getPoints(peaksItems);
    peaks.segments.add(segments);
    peaks.points.add(points);
  }

  /**
   * Removes each item from Peaks.js, hiding it from the waveform.
   * @param {!Array.<PeaksItem>} peaksItems - The `PeaksItem`s to hide.
   */
  static hideFromPeaks(peaksItems) {
    const segments = PeaksItem.getSegments(peaksItems);
    const points = PeaksItem.getPoints(peaksItems);
    segments.forEach((segment) => peaks.segments.removeById(segment.id));
    points.forEach((point) => peaks.points.removeById(point.id));
  }

  /**
   * The Peaks.js Segment or Point being represented in the tree by this `PeaksItem`.
   * @type {(!PeaksSegment|!PeaksPoint)}
   */
  peaksItem;

  /**
   * Indicates if `peaksItem` is a segment or a point.
   * @type {("Segment"|"Point")}
   */
  type;

  /**
   * A `boolean` indicating if this segment is editable.
   * This is the true value of this segments' editablility and isn't changed.
   * It is used for determining if this segment has drag handles and for
   * showing / hiding said drag handles if it has them.
   * @type {boolean}
   */
  #editable;

  /**
   * A `boolean` indicating if this segment is currently editable.
   * If the segment isn't editable, this is always `false`. Otherwise, this is `true`
   * if this segment's drag handles are shown and `false` if they're hidden.
   * @type {boolean}
   */
  currentlyEditable;

  /**
   * @param {(!PeaksSegment|!PeaksPoint)} peaksItem - The Peaks.js segment / point being
   *      represented in the tree by the `PeaksItem`.
   * @param {?Object.<string, any>=} options - Options to customize the item.
   * @param {?PeaksGroup=} options.parent - The `PeaksGroup` that contains the item
   *      in its nested content.
   * @param {string=} options.text - The text to show in the item's span (and
   *      therefore in the tree).
   * @param {boolean} [options.playable=false] - Indicates if the segment / point
   *      can be played.
   * @param {boolean} [options.removable=false] - Indicates if the segment / point
   *      can be removed from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the segment / point
   *      can be renamed.
   * @param {?Array.<PeaksGroup>=} options.moveTo - An array of the `PeaksGroup`s that
   *      the item can be moved to. `null` if the item isn't moveable.
   * @param {?Array.<PeaksGroup>=} options.copyTo - An array of the `PeaksGroup`s that
   *      the item can be copied to. `null` if the item isn't copyable.
   * @param {boolean} [options.render=true] - If `true`, `render()` is called in
   *      the constructor. Otherwise, `render()` is not called and is left to the
   *      user to call.
   * @throws {Error} If a `TreeItem` with `peaksItem.id` already exists.
   */
  constructor(
    peaksItem,
    {
      parent = null,
      text = null,
      playable = false,
      removable = false,
      renamable = false,
      moveTo = null,
      copyTo = null,
      render = true,
      attributes = null,
      saveable = true,
    } = {},
  ) {
    // catch options contained within the peaks item
    text = text || peaksItem.treeText;
    // peaksItem.removable and peaksItem.renamable are non-null if they are loaded
    // from saved peaks items in the database
    removable = peaksItem.removable != null ? peaksItem.removable : removable;
    renamable = peaksItem.renamable != null ? peaksItem.renamable : renamable;

    // don't render yet because some methods rely on this.segment but not defined yet
    // (can't use 'this' until after super() call, so
    // can't define this.segment until after)
    super(peaksItem.id, {
      text,
      playable,
      removable,
      renamable,
      moveTo,
      copyTo,
      render: false,
      attributes,
      saveable,
    });
    this.peaksItem = peaksItem;
    this.type = peaksItem.constructor.name === "Segment" ? "Segment" : "Point";

    if (render) {
      this.render();
    }
    parent?.addChildren?.(this);

    this.#editable = this.peaksItem.editable;
    this.currentlyEditable = this.peaksItem.editable;
  }

  toObject() {
    if (!this.saveable) {
      return null;
    }
    const json = super.toObject();
    const { id, labelText, color } = this.peaksItem;
    const peaksItemOpts = { id, labelText, color };
    if (this.parent && labelText === `${this.parent.id}\n${this.text}`) {
      peaksItemOpts.labelText = this.text;
    }
    // peaksItemOpts.labelText = labelText.replace(`${this.parent.id}\n`, "");
    // Peaks defaults to editable = false, so adding false would be redundant
    if (this.#editable) {
      peaksItemOpts.editable = this.#editable;
    }
    if (this.type === "Segment") {
      peaksItemOpts.startTime = this.peaksItem.startTime;
      peaksItemOpts.endTime = this.peaksItem.endTime;
    } else {
      peaksItemOpts.time = this.peaksItem.time;
    }
    json.arguments = [peaksItemOpts];
    return json;
  }

  /**
   * A `boolean` indicating if this segment can be edited. If it
   * is editable, this segment will have handles at its start and
   * end that allow changing its start and end times.
   * @type {boolean}
   */
  get editable() {
    return this.#editable;
  }

  /**
   * This segment's color in the Peaks waveform.
   * @type {!Color}
   */
  get color() {
    return this.peaksItem.color;
  }

  /**
   * The segment's text label.
   * It is displayed when the segment is hovered over by the mouse pointer.
   * @type {string}
   */
  get labelText() {
    return this.peaksItem.labelText;
  }

  /**
   * Updates properties of the Peaks segment.
   * @param {!Object.<string, any>} options - Options specifying the new values of
   *      the properties being updated.
   * @param {number=} options.startTime - If this item is a `PeaksSegment`, the
   *      segment's start time in seconds.
   * @param {number=} options.endTime - If this item is a `PeaksSegment`, the
   *      segment's end time in seconds.
   * @param {number=} options.time - If this item is a `PeaksPoint`, the point's
   *      time in seconds.
   * @param {boolean=} options.editable - Indicates if the segment / point can be
   *      edited (moved around).
   * @param {?Color=} options.color - The segment's / point's color in the Peaks
   *      waveform.
   * @param {string=} options.labelText - The segment's / point's text label.
   */
  update(options) {
    this.peaksItem.update(options);
  }

  /**
   * Toggles this Peaks.js item's drag handles.
   * This only has an effect if this item is editable as only editable
   * `PeaksSegment`s and `PeaksPoint`s have drag handles.
   * @param {boolean=} force - If unspecified, the drag handles are always toggled.
   *      Otherwise, the drag handles are only toggled if their current state isn't
   *      equal to `force`.
   * @return {?boolean} If this item is editable, returns a `boolean` indiciating if
   *      any toggling was done. In other words, when `force == null`, returns `true`
   *      and returns `force !== checked` when `force != null`. If this item isn't
   *      editable, returns `null`.
   */
  toggleDragHandles(force = null) {
    if (!this.#editable) {
      return null;
    } // this segment isn't editable
    if (force === this.peaksItem.editable) {
      return false; // false indicates nothing changed (no toggling necessary)
    }

    const enabled = force === null ? !this.peaksItem.editable : force;
    this.currentlyEditable = enabled;
    // only update if peaksItem is visible. If not visible, it's updated when toggled on
    // because if update peaksItem when hidden, it becomes visible
    if (this.checked) {
      this.peaksItem.update({ editable: enabled });
    }

    return true;
  }

  /**
   * Updates this peaksItem's editability.
   * Called when this peaksItem is toggled. It is used to update the Peaks peaksItem's
   * editability in order to show / hide the drag handles.
   */
  updateEditable() {
    if (this.currentlyEditable != this.peaksItem.editable) {
      this.peaksItem.update({ editable: this.currentlyEditable });
    }
  }

  /** Adds this segment / point to the Peaks.js waveform. */
  #addToPeaks() {
    // instanceof can't work because Segment can't be imported from Peaks,
    // so this is the only way I know of to test its type
    if (this.type === "Segment") {
      peaks.segments.add(this.peaksItem);
    } else {
      peaks.points.add(this.peaksItem);
    }
  }

  /** Removes this segment / point from the Peaks.js waveform. */
  #removeFromPeaks() {
    if (this.type === "Segment") {
      peaks.segments.removeById(this.id);
    } else {
      peaks.points.removeById(this.id);
    }
  }

  /** Sets the CSS styling of the peaksItem's elements. */
  style() {
    if (this.rendered) {
      this.li.style.fontSize = "12px";
      this.checkbox.style.transform = "scale(0.85)";
    }
  }

  /** Removes this segment / point from the tree and Peaks waveform. */
  remove() {
    if (this.parent.visible.has(this)) {
      this.#removeFromPeaks();
      this.parent.visible.delete(this);
    } else {
      this.parent.hidden.delete(this);
    }
    super.remove();
  }

  /**
   * Readds this item.
   * To be specific, adds this item to `byId`, to Peaks, and to `parent` if not
   * `null`. If `parent` is `null` and `this.parent` isn't, `this.parent` is used
   * instead. Otherwise, if both are `null`, this item isn't added to any parent.
   * @param {?PeaksGroup} parent - The `PeaksGroup` to add this item to, if any.
   * @param {boolean} [render=true] - Whether to render this item after readding it.
   */
  readd(parent = null, render = true) {
    this.#addToPeaks();
    super.readd(parent, render);
  }

  /**
   * Renames this Peaks.js item, replacing its text and labelText. Its id is
   * unchanged.
   * @param {string} newText - The new text to give this item.
   */
  rename(newText) {
    super.text = newText;
    if (this.parent) {
      this.peaksItem.update({ labelText: `${this.parent.id}\n${newText}` });
    } else {
      this.peaksItem.update({ labelText: newText });
    }
  }

  /**
   * Toggles this `PeaksItem` on / off.
   * Specifically, toggles this item's elements on / off and
   * shows / hides its Peaks.js segment / point on the Peaks.js waveform.
   * @param {boolean=} force - If unspecified, this item is always toggled.
   *      Otherwise, it's only toggled if its current state isn't equal to `force`.
   * @return {boolean} A `boolean` indiciating if any toggling was done. In other words,
   *      when `force == null`, returns `true`. Otherwise, returns `force !== checked`.
   * @see toggleTree
   */
  toggle(force = null) {
    if (!this.toggleTree(force)) {
      return false;
    } // no toggling necessary

    // this.checked will be changed by toggleTree
    if (this.checked) {
      // add item to peaks
      this.#addToPeaks();
      this.parent.hidden.delete(this);
      this.parent.visible.add(this);
      this.updateEditable();
    } else {
      // remove item from peaks
      this.#removeFromPeaks();
      this.parent.visible.delete(this);
      this.parent.hidden.add(this);
    }

    return true;
  }
};

/**
 * A `TreeItem` for a Peaks.js segment.
 * @extends PeaksItem
 */
var Segment = class Segment extends PeaksItem {
  /**
   * An object containing all `Segment`s by their id.
   * Key is id, value is corresponding `Segment`:
   * {id: `Segment`}
   * @type {!Object.<string, Segment>}
   * @static
   */
  static byId = {};

  static #idCounter = new IdCounter("segment.%d");

  /**
   * @param {(!PeaksSegment|!PeaksSegmentOptions)} segment - The Peaks segment or the
   *      options to create it.
   * @param {?Object.<string, any>=} options - Options to customize the segment.
   * @param {?PeaksGroup=} options.parent - The `PeaksGroup` that contains the segment
   *      in its nested content.
   * @param {string=} options.text - The text to show in the segment's span (and
   *      therefore in the tree).
   * @param {boolean} [options.removable=false] - Indicates if the segment can be
   *      removed from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the segment can be
   *      renamed.
   * @param {?Array.<PeaksGroup>=} options.moveTo - An array of the `PeaksGroups`s that
   *      the segment can be moved to. `null` if the segment isn't moveable.
   * @param {?Array.<PeaksGroup>=} options.copyTo - An array of the `PeaksGroups`s that
   *      the segment can be copied to. `null` if the segment isn't copyable.
   * @throws {Error} If a `TreeItem` with `segment.id` already exists.
   */
  constructor(
    segment,
    {
      parent = null,
      text = null,
      removable = false,
      renamable = false,
      moveTo = null,
      copyTo = null,
      attributes = null,
      saveable = true,
    } = {},
  ) {
    if (segment.constructor.name !== "Segment") {
      if (segment.id) {
        Segment.#idCounter.update(segment.id);
      } else {
        segment.id = Segment.#idCounter.next();
        // this shouldn't happen, but just in case
        while (Segment.byId[segment.id]) {
          console.warn(
            `Segment with generated id ${segment.id} already exists.` +
              " Generating new id.",
          );
          segment.id = Segment.#idCounter.next();
        }
      }
      segment = peaks.segments.add(segment);
    } else {
      Segment.#idCounter.update(segment.id);
    }
    super(segment, {
      parent,
      text,
      playable: true,
      removable,
      renamable,
      moveTo,
      copyTo,
      attributes,
      saveable,
    });

    this.updateDuration();

    // segment only needs a popup if it's renamable, movable, or copyable
    if (this.renamable || this.moveTo || this.copyTo) {
      this.popup = new Popup(this);
    }
  }

  toObject() {
    if (!this.saveable) {
      return null;
    }
    const json = super.toObject();
    // playable will be in options since it's true, which is different than TreeItem's
    // default (false). We want to remove it since it's not an option for Segment and
    // it's redundant.
    delete json.options.playable;
    return json;
  }

  /**
   * The Peaks.js segment being represented in the tree by this `Segment`.
   * @type {!PeaksSegment}
   */
  get segment() {
    return this.peaksItem;
  }

  /**
   * This segment's start time in seconds.
   * @type {number}
   */
  get startTime() {
    return this.segment.startTime;
  }
  set startTime(newStart) {
    this.segment.update({ startTime: newStart });
    this.updateDuration();
  }

  /**
   * This segment's end time in seconds.
   * @type {number}
   */
  get endTime() {
    return this.segment.endTime;
  }
  set endTime(newEnd) {
    this.segment.update({ endTime: newEnd });
    this.updateDuration();
  }

  /**
   * The text shown in `span` (and therefore in the tree).
   * @type {string}
   */
  get treeText() {
    return this.text;
  } // backwards compatibility (database expects 'treeText')

  update(options) {
    super.update(options);
    if (options.startTime !== undefined || options.endTime !== undefined) {
      this.updateDuration();
    }
  }

  /** Updates `duration` using this segment's start and end times. */
  updateDuration() {
    const newDuration = this.endTime - this.startTime;
    const durationChange = newDuration - this.duration;
    this.duration = newDuration;
    this.updateSpanTitle();
    if (this.parent) {
      this.parent.updateDuration(durationChange);
    }
  }

  /** Updates the title (tooltip) of `span`. */
  updateSpanTitle() {
    this.span.title =
      `Start time: ${this.startTime.toFixed(2)}\n` +
      `End time: ${this.endTime.toFixed(2)}\n` +
      `Duration: ${this.duration.toFixed(2)}`;
    if (this.attributes !== null) {
      this.span.title += `\n${mappingToString(this.attributes)}`;
    }
  }

  /**
   * Plays this segment.
   * @param {boolean} [loop=false] - If `true`, loops this segment (reaching
   *      the end of the segment will restart playing at the beginning).
   */
  play(loop = false) {
    // pause in case anything else is playing so that
    // their icons get switched back to play and loop
    media.pause();
    media.currentTime = this.startTime; // seek
    media.play();
    this.switchToPauseButton(loop);
    window.requestAnimationFrame(() => this.#playCallback(loop));
  }

  // called every frame to check if media is still playing
  // and whether the end of the segment has been reached
  #playCallback(loop) {
    // if it's paused here, then the user manually paused it by clicking
    // pause button in the tree or on the media (instead of pausing because
    // the end of the segment was reached)
    if (media.paused) {
      this.pause();
      // we don't want to request another animation frame since we're
      // not playing anymore so stop the function here
      return;
    }

    if (media.currentTime >= this.endTime) {
      if (loop) {
        media.currentTime = this.startTime; // seek
      } else {
        media.pause();
        this.switchBackToPlayLoopButtons();
        // emit an "ended" event to indicate that the segment reached its end
        // normally, and wasn't paused by the user. This way, if a Group played
        // this segment, it knows to start the next one
        // bubbles: true so the Group actually receives the event
        this.dispatchEvent(new Event("ended", { bubbles: true }));
        return;
      }
    }

    window.requestAnimationFrame(() => this.#playCallback(loop));
  }

  /** Pauses playback of this segment if it is playing. */
  pause() {
    media.pause();
    this.switchBackToPlayLoopButtons();
    // built-in events like "animationstart" don't use camel case or dashes
    // so that's why "manualpause" is all lowercase and one word
    // bubbles: true so that parents can catch the event, e.g. if this
    // segment was played by a Group, the Group needs to receive the "manualpause"
    // event as well so that it can get paused properly
    this.dispatchEvent(new Event("manualpause", { bubbles: true }));
  }

  /**
   * Splits this segment into 2 segments.
   *
   * @returns {!Segment} The new segment.
   */
  split() {
    if (this.duration < 0.15) {
      return null; // don't split if segment is too short
    }

    let newSegStart = this.startTime + this.duration / 2;
    const newSegEnd = this.endTime;
    this.endTime = newSegStart;
    // if there's enough room, leave a tiny gap between the segments so that the drag
    // handles don't overlap
    if (this.duration > 0.3) {
      // 0.0375 is from trial and error, leaves a tiny tiny gap between the drag handles
      newSegStart += 0.0375;
      this.endTime -= 0.0375;
    }
    this.updateDuration();

    const newSegment = peaks.segments.add({
      startTime: newSegStart,
      endTime: newSegEnd,
      editable: this.editable,
      labelText: this.labelText,
    });
    return new Segment(newSegment, {
      parent: this.parent,
      text: this.text,
      removable: this.removable,
      renamable: this.renamable,
      moveTo: this.moveTo,
      copyTo: this.copyTo,
      attributes: this.attributes,
    });
  }

  /**
   * Copies this segment to another `PeaksGroup`.
   * @param {!PeaksGroup} copyParent - `PeaksGroup` to add the copied segment to.
   * @returns {?Segment} The copied segment if `copyParent` didn't already have a
   *      copy of this segment. Otherwise, `null`.
   */
  copy(copyParent) {
    // only copy if the new parent doesn't already have a copy of the segment
    if (
      !copyParent.children.some((child) =>
        propertiesEqual(this.segment, child.segment, ["startTime", "endTime"]),
      )
    ) {
      const newSegment = peaks.segments.add({
        startTime: this.startTime,
        endTime: this.endTime,
        editable: true,
      });
      return new Segment(newSegment, {
        parent: copyParent,
        text: this.text,
        removable: true,
        renamable: true,
        // TODO: unhardcode this
        moveTo: [Group.byId["Labeled"].children],
      });
    }
    return null;
  }

  // FIXME: this assumes the segments overlap
  /**
   * Merges this segment with the given segments.
   *
   * @param {...Segment} segments - Segments to merge with this segment. All
   *     segments must overlap this segment. They will be removed after merging.
   */
  merge(...segments) {
    segments.forEach((segment) => {
      if (segment.startTime < this.startTime) {
        this.startTime = segment.startTime;
      }
      if (segment.endTime > this.endTime) {
        this.endTime = segment.endTime;
      }
      segment.remove();
    });
  }
};

/**
 * A `TreeItem` for a Peaks.js point.
 * @extends PeaksItem
 */
var Point = class Point extends PeaksItem {
  /**
   * An object containing all `Point`s by their id.
   * Key is id, value is corresponding `Point`:
   * {id: `Point`}
   * @type {!Object.<string, Point>}
   * @static
   */
  static byId = {};

  static #idCounter = new IdCounter("point.%d");

  /**
   * @param {!PeaksPoint} point - The Peaks point being represented in the tree by
   *       the `Point`.
   * @param {?Object.<string, any>=} options - Options to customize the point.
   * @param {?Peaksgroup=} options.parent - The `PeaksGroup` that contains the point
   *       in its nested content.
   * @param {string=} options.text - The text to show in the point's span (and
   *       therefore in the tree).
   * @param {boolean} [options.removable=false] - Indicates if the point can be
   *       removed from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the point can be
   *       renamed.
   * @param {?Array.<PeaksGroup>=} options.moveTo - An array of the `PeaksGroups`s that
   *      the point can be moved to. `null` if the point isn't moveable.
   * @param {?Array.<PeaksGroup>=} options.copyTo - An array of the `PeaksGroups`s that
   *      the point can be copied to. `null` if the point isn't copyable.
   * @param {boolean} [options.render=true] - If `true`, `render()` is called in
   *      the constructor. Otherwise, `render()` is not called and is left to the
   *      user to call.
   * @throws {Error} If a `TreeItem` with `point.id` already exists.
   */
  constructor(
    point,
    {
      parent = null,
      text = null,
      removable = false,
      renamable = false,
      moveTo = null,
      copyTo = null,
      render = true,
      saveable = true,
    } = {},
  ) {
    if (point.constructor.name !== "Point") {
      if (point.id) {
        Point.#idCounter.update(point.id);
      } else {
        point.id = Point.#idCounter.next();
        // this shouldn't happen, but just in case
        while (Point.byId[point.id]) {
          console.warn(
            `Point with generated id ${point.id} already exists. Generating new id.`,
          );
          point.id = Point.#idCounter.next();
        }
      }
      point = peaks.points.add(point);
    } else {
      Point.#idCounter.update(point.id);
    }
    super(point, {
      parent,
      text,
      removable,
      renamable,
      moveTo,
      copyTo,
      render,
      saveable,
    });

    if (this.renamable || this.moveTo || this.copyTo) {
      this.popup = new Popup(this);
    }
  }

  /**
   * The Peaks.js point being represented in the tree by this `Point`.
   * @type {!PeaksPoint}
   */
  get point() {
    return this.peaksItem;
  }

  /**
   * This point's timestamp in seconds.
   * @type {number}
   */
  get time() {
    return this.point.time;
  }
  set time(newTime) {
    this.point.update({ time: newTime });
  }
};

/**
 * A `Point` used to show a word on the Peaks.js waveform.
 * This item isn't rendered in the tree.
 * @extends Point
 */
var Word = class Word extends Point {
  /**
   * An object containing all `Word`s by their id.
   * Key is id, value is corresponding `Word`:
   * {id: `Word`}
   * @type {!Object.<string, Word>}
   * @static
   */
  static byId = {};

  /**
   * @param {!PeaksPoint} point - The Peaks point being represented in the tree by
   *       the `Word`.
   * @param {?Object.<string, any>=} options - Options to customize the word.
   * @param {?Peaksgroup=} options.parent - The `PeaksGroup` that contains the word
   *       in its nested content.
   * @throws {Error} If a `TreeItem` with `point.id` already exists.
   */
  constructor(point, { parent = null, saveable = true } = {}) {
    super(point, { parent, saveable, text: point.labelText, render: false });
  }

  toObject() {
    if (!this.saveable) {
      return null;
    }
    const json = super.toObject();
    // text will be in options because it's not this.id, but we don't need to save it
    // because it's not an option for Word
    delete json.options.text;
    return json;
  }

  /**
   * Renames this word, replacing its labelText. Its id is unchanged.
   * @param {string} newId - The new id to give this item.
   */
  rename(newText) {
    this.peaksItem.update({ labelText: newText });
  }
};

/**
 * A group of `PeaksItem`s.
 * @extends Group
 */
var PeaksGroup = class PeaksGroup extends Group {
  /**
   * An object containing all `PeaksGroup`s by their id.
   * Key is id, value is corresponding `PeaksGroup`:
   * {id: `PeaksGroup`}
   * @type {!Object.<string, PeaksGroup>}
   * @static
   */
  static byId = {};

  /**
   * The signal-to-noise ratio (SNR) of this `PeaksGroup` if it has one.
   * Otherwise, `null`.
   * @type {?number}
   */
  snr = null;

  /**
   * The color of this group's `PeaksItem`s in the Peaks waveform.
   * If no color is given in the constructor, `null` until a
   * `PeaksItem` is added to this group.
   * @type {?Color}
   */
  #color = null;

  /**
   * A `boolean` indicating if this item can be recolored.
   * @type {boolean}
   */
  colorable;

  /**
   * A set containing the `PeaksItem`s that are currently hidden in Peaks.
   * @type {!Set.<PeaksItem>}
   */
  hidden = new Set();

  /**
   * A set containing the `PeaksItem`s that are currently visible in Peaks.
   * @type {!Set.<PeaksItem>}
   */
  visible = new Set();

  /**
   * Face number this face is associated with, for saving purposes
   * @type {?number}
   */
  faceNum = null;

  /**
   * @param {string} id - The unique identifier to give the `PeaksGroup`.
   * @param {?Object.<string, any>=} options - Options to customize the `PeaksGroup`.
   * @param {?TreeItem=} options.parent - The `TreeItem` that contains
   *      the group in its nested content.
   * @param {?Array.<PeaksItem>=} options.children - An array of `PeaksItem`s to put
   *      in the group's nested content.
   * @param {number=} options.snr - The signal-to-noise ratio of the group.
   * @param {string=} options.text - The text to show in the group's span (and
   *      therefore in the tree). If `null`, `id` is used.
   * @param {boolean} [options.playable=true] - Indicates if the group can be played
   *      and looped.
   * @param {boolean} [options.removable=false] - Indicates if the group can be
   *      removed from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the group can be
   *      renamed.
   * @param {Color=} options.color - The `Color` to give the group's items. If
   *      `null`, the color of the first `PeaksItem` added to the group will be used.
   * @param {boolean} [options.colorable=false] - Indicates if the group can be
   *       recolored.
   * @param {?Array.<string>=} [options.moveTo] - An array of the ids of `TreeItem`s
   *      that the group can be moved to. `null` if the group isn't moveable.
   * @param {?Array.<string>=} [options.copyTo] - An array of the ids of `TreeItem`s
   *      that the group can be copied to. `null` if the group isn't copyable.
   * @throws {Error} If a `TreeItem` with `id` already exists.
   */
  constructor(
    id,
    {
      parent = null,
      children = null,
      snr = null,
      text = null,
      playable = true,
      removable = false,
      renamable = false,
      color = null,
      colorable = false,
      moveTo = null,
      copyTo = null,
      saveable = true,
    } = {},
  ) {
    // always have to call constructor for super class (TreeItem)
    super(id, {
      parent,
      children,
      text,
      playable,
      removable,
      renamable,
      moveTo,
      copyTo,
      saveable,
    });

    this.snr = snr;
    if (children) {
      this.sortBy("startTime");
    }

    if (color) {
      this.#color = color;
    }
    this.colorable = colorable;

    if (renamable || moveTo || copyTo || colorable) {
      this.popup = new Popup(this);
    }
  }

  toObject() {
    if (!this.saveable) {
      return null;
    }
    const json = super.toObject();
    // this.snr *could* be 0, so check if non-null explicitly instead of "if (this.snr)"
    if (this.snr !== null) {
      json.options.snr = this.snr;
      // since this has an snr, it may have been ranked in init.js
      // ranking adds a circled number to the group's
      json.options.text = this.text.replaceAll(circleNumRegex, "");
      if (json.options.text == this.id) {
        delete json.options.text;
      }
    }
    if (this.color) {
      json.options.color = this.color;
      json.options.children?.forEach((child) => {
        // children are PeaksItems (or its subclasses), which usually will have the
        // peaks item options in the first argument, (but might not if they're a
        // subclass of PeaksItem)
        if (child?.arguments?.[0]?.color === this.color) {
          // if child has same color as group, don't save it because it's
          // automatically assigned the group's color
          delete child.arguments[0].color;
        }
      });
    }
    // only save colorable if it's true, since it's false by default
    if (this.colorable) {
      json.options.colorable = this.colorable;
    }
    // playable is true by default, so only save if it's false
    if (this.playable) {
      // if playable, it'll be in options since it's different than TreeItem's default
      delete json.options.playable;
    } else {
      json.options.playable = this.playable;
    }
    return json;
  }

  /**
   * The color of this group's `PeaksItem`s in the Peaks waveform.
   * If no color is given in the constructor, `null` until a
   * `PeaksItem` is added to this group.
   * @type {?Color}
   */
  get color() {
    return this.#color;
  }
  set color(newColor) {
    if (this.#color && !this.colorable) {
      throw new Error(`TreeItem ${this.id} is not colorable.`);
    }
    this.#color = newColor;
    this.children.forEach((peaksItem) => peaksItem.update({ color: newColor }));
  }

  /**
   * Adds `PeaksItem`s to this group's nested content.
   * @param  {...PeaksItem} children - The children to add.
   */
  addChildren(...children) {
    if (this.#color === null && children.length > 0) {
      this.#color = children[0].color;
    }
    for (const child of children) {
      super.addChildren(child);

      child.update({ color: this.#color });
      // rename with the same text because renaming adds the parent's id to the
      // peaks item's labelText, so we need to update from the old parent's id
      // also good to use rename() instead of copying the code from rename
      // so that subclasses can override this labelText behavior
      child.rename(child.text);

      if (child.checked) {
        this.visible.add(child);
      } else {
        this.hidden.add(child);
      }
    }
    this.sortBy("startTime");
  }

  /**
   * Removes `PeaksItem`s from this group's nested content.
   * @param  {...PeaksItem} children - The children to remove.
   */
  removeChildren(...children) {
    for (const child of children) {
      this.visible.delete(child);
      this.hidden.delete(child);
      super.removeChildren(child);
    }
  }

  /** Updates the title (tooltip) of `span`. */
  updateSpanTitle() {
    if (this.snr && this.snr != "NAN" && this.duration != 0) {
      this.span.title = `SNR: ${this.snr.toFixed(
        2,
      )}\nDuration: ${this.duration.toFixed(2)}`;
    } else {
      super.updateSpanTitle();
    } // if group doesn't have snr, uses default span title
  }

  /**
   * Renames this group, replacing its id, text, and the labelText of
   * each of its items.
   * @param {string} newId - The new id to give this group.
   * @returns {boolean} A `boolean` indicating if renaming was successful.
   *      Renaming is successful if there's no `TreeItem` with `newId`.
   */
  rename(newId) {
    try {
      super.rename(newId);
    } catch (error) {
      return false;
    } // unsuccessful because TreeItem with newId already exists
    this.hidden.forEach((peaksItem) =>
      // rename with the same text because renaming adds the parent's id to this
      // peaks item's labelText, so we need to update from the old parent's id
      peaksItem.rename(peaksItem.text),
    );
    this.visible.forEach((peaksItem) => peaksItem.rename(peaksItem.text));
    return true;
  }

  /**
   * Toggles this group on / off.
   * Specifically, toggles this group's elements on / off and shows / hides all of its
   * `PeaksItem`s on the Peaks waveform.
   * @param {boolean=} force - If unspecified, this group is always toggled. Otherwise,
   *      this group is only toggled if its current state isn't equal to `force`.
   * @return {boolean} A `boolean` indiciating if any toggling was done. In other words,
   *      when `force == null`, returns `true`. Otherwise, returns `force !== checked`.
   * @see toggleTree
   */
  toggle(force = null) {
    if (!this.toggleTree(force)) {
      return false;
    } // no toggling necessary

    // this.checked will be changed by toggleTree
    this.children.forEach((child) => child.toggleTree(this.checked));
    if (this.checked) {
      PeaksItem.showOnPeaks(this.hidden);
      this.hidden.forEach((peaksItem) => {
        peaksItem.updateEditable();
        this.visible.add(peaksItem);
      });
      this.hidden.clear();
    } else {
      PeaksItem.hideFromPeaks(this.visible);
      this.visible.forEach((peaksItem) => this.hidden.add(peaksItem));
      this.visible.clear();
    }

    return true;
  }

  /**
   * Copies all of the `PeaksItem`s of this group to another.
   * @param {!PeaksGroup} copyParent - `PeaksGroup` to add the copied items to.
   * @returns {!Array.<PeaksItem>} The array of copied `PeaksItem`s.
   */
  copy(copyParent) {
    const copiedChildren = [];
    for (const child of this.children) {
      const copiedChild = child.copy(copyParent);
      if (copiedChild) {
        copiedChildren.push(copiedChild);
      }
    }
    return copiedChildren;
  }

  /**
   * Gets the `Segment`s of this group that overlap with `segment`.
   *
   * @param {!Segment} segment - The `Segment` to check for overlap with.
   * @returns {!Array.<Segment>} The `Segment`s of this group that overlap with
   *      `segment`.
   */
  getOverlapping(segment) {
    const overlapping = [];
    for (const child of this.children) {
      if (child.startTime >= segment.endTime) {
        break;
      } else if (child.endTime > segment.startTime && child !== segment) {
        overlapping.push(child);
      }
    }
    return overlapping;
  }
};

/**
 * A `TreeItem` for a face from clustering face detection on the video
 * @extends TreeItem
 */
var Face = class Face extends TreeItem {
  /**
   * An object containing all `Face`s by their id.
   * Key is id, value is corresponding `Face`:  {id: `Face`}
   * @type {Object.<string, Face>}
   * @static
   */
  static byId = {};

  /**
   * HTML strings for the remove icons for `Face`s in the tree
   * @type {Object.<string, string>}
   * @static
   */
  static icons = segmentIcons;

  /**
   * The link to the page showing every image for this face.
   * @type {string}
   */
  faceHref;

  /**
   * Path to image displayed for a face
   * @type {string}
   */
  imagePath;

  /**
   * Button that links to a page with every single face in this cluster
   * @type {HTMLAnchorElement}
   */
  linkButton;

  /**
   * Li for the image shown for a face
   * @type {HTMLLIElement}
   */
  imageLi;

  /**
   * The id of the `Group` this face is currently associated with.
   * @type {?string}
   */
  currentAssoc = null;

  /**
   * @param {string} id - The unique identifier to give the `Face`.
   * @param {?Object.<string, any>=} options - Options to customize the `Face`.
   * @param {?TreeItem=} options.parent - The `TreeItem` that contains the item in its
   *      nested content.
   * @param {string=} options.text - The text to show in the item's span (and
   *      therefore in the tree). If `null`, `id` is used.
   * @param {boolean} [options.removable=true] - Indicates if the item can be removed
   *      from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the item can be renamed.
   * @param {?Array.<TreeItem>=} [options.assocWith] - An array of the `TreeItem`s
   *      that Face can be associated with. `null` if the Face isn't able to be
   *      associated.
   * @param {string=} options.faceHref - The link to the page showing every image for
   *      this face.
   * @param {string=} options.imagePath - The name of the image shown for this face
   * @param {string=} options.currentAssoc - The id of the `Group` this face is
   *      currently associated with.
   * @param {boolean} [options.saveable=true] - Indicates if the item is saveable.
   *      If `true`, `toObject` will return an object containing the arguments and
   *      options necessary to recreate the item. Otherwise, `toObject` will return
   *      `null`.
   * @throws {Error} If a `TreeItem` with `id` already exists.
   */
  constructor(
    id,
    {
      parent = null,
      text = null,
      removable = true,
      renamable = false,
      assocWith = null,
      faceHref = null,
      imagePath = null,
      currentAssoc = null,
      saveable = true,
    } = {},
  ) {
    // (can't use 'this' until after super() call,
    // so can't get rid of playButton, etc. until after super())
    super(id, {
      parent,
      text,
      removable,
      renamable,
      assocWith,
      saveable,
    });

    // rel="noopener noreferrer" is there to avoid tab nabbing
    this.linkButton = html`<a
      href="${faceHref}"
      style="text-decoration:none;"
      target="_blank"
      rel="noopener noreferrer"
      class="button-on"
      >${this.constructor.icons.image}</a
    >`;
    this.nested.before(this.linkButton);

    // change width and height here if you want a different sized image to show
    this.imageLi = html`<li>
      <img
        src="${imagePath}"
        width="100px"
        height="100px"
        alt="Example image of face"
      />
    </li>`;

    this.imageLi.addEventListener("click", () => {
      // Only push a new action if the face is actually associated with a speaker
      // (since you can click on the image even when it's in the Clusters group)
      if (this.currentAssoc !== null) {
        undoStorage.push(new Actions.UnassociateAction(this));
      }
    });
    this.nested.appendChild(this.imageLi);
    this.popup = new Popup(this);

    this.faceHref = faceHref;
    this.imagePath = imagePath;
    if (currentAssoc) {
      this.assoc(Group.byId[currentAssoc]);
    }
  }

  toObject() {
    if (!this.saveable) {
      return null;
    }
    const json = super.toObject();
    json.options.imagePath = this.imagePath;
    json.options.faceHref = this.linkButton.href;
    if (this.currentAssoc !== null) {
      json.options.currentAssoc = this.currentAssoc;
    }
    return json;
  }

  get speaker() {
    return this.currentAssoc ? PeaksGroup.byId[this.currentAssoc] : null;
  }

  /** Initialize the CSS styling of the `Face` */
  style() {
    this.li.style.fontSize = "12px";
    this.checkbox.style.transform = "scale(0.85)";
  }

  /**
   * Associates this face with a `PeaksGroup`, displaying this face's image with the
   * group.
   * @param {PeaksGroup} speaker - The group to send this face's image to.
   */
  assoc(speaker) {
    this.currentAssoc = speaker.id;
    speaker.faceNum = this.id;
    speaker.nested.before(this.imageLi);
  }

  /**
   * Unassociates this face from its `PeaksGroup` (if any), moving its image back
   * to this face's tree item.
   */
  unassoc() {
    this.nested.appendChild(this.imageLi);
    if (this.currentAssoc !== null) {
      // TODO: Blake, is setting face on the PeaksGroup necessary? Just asking
      //       because I don't think PeaksGroup needs to know anything about Face
      PeaksGroup.byId[this.currentAssoc].faceNum = null;
      this.currentAssoc = null;
    }
  }
};

var File = class File extends TreeItem {
  /**
   * An object containing all `File`s by their id.
   * Key is id, value is corresponding `File`:  {id: `File`}
   * @type {Object.<string, File>}
   * @static
   */
  static byId = {};

  /**
   * Stores what the file being viewed right now is
   * @type {string}
   * @static
   */
  static currentFile;

  /**
   * @param {string} filename - The name of the file, including its extension.
   * @param {?TreeItem=} options.parent - The `TreeItem` that contains the item in its
   *      nested content.
   * @param {string=} options.text - The text to show in the item's span (and
   *      therefore in the tree). If `null`, `filename` is used.
   * @param {boolean} [options.renamable=false] - Indicates if the item can be renamed.
   * @throws {Error} If a `TreeItem` with an id equal to `filename` already exists.
   */
  constructor(
    filename,
    { parent = null, text = null, renamable = false, curFile } = {},
  ) {
    super(filename, {
      parent,
      text,
      renamable,
      saveable: false,
    });
    this.currentFile = curFile;
    this.toggleTree(false);
    this.checkbox.type = "radio";
    this.checkbox.name = "radioFiles";
    this.parent.addEventListener("click", () => {
      File.byId[curFile].toggleTree(true); // turn on button for current file
    });
    this.addEventListener("click", () => {
      if (this.id !== this.currentFile) {
        // don't allow the same file to be clicked again and
        this.openFile();
      } else {
        // if the same radio button is clicked don't unclick it
        this.toggleTree(true);
      }
    });
  }

  /**
   * The name of the file that this `File` represents, including its extension.
   * @type {string}
   */
  get filename() {
    return this.id;
  }

  /**
   * The name of the file that this `File` represents, without its extension.
   * @type {string}
   */
  get basename() {
    return removeExtension(this.filename);
  }

  /**
   * An alias for `this.toggleTree(force)`, with the addition of opening this' file
   * in the interface if this is checked.
   * @see toggleTree
   */
  toggle() {
    if (!this.toggleTree(false)) {
      return false;
    } // no toggling necessary

    if (this.checked) {
      this.openFile();
    }
  }

  openFile() {
    let tempWindowLocationHref = window.location.href;
    tempWindowLocationHref = tempWindowLocationHref.replace(
      `file=${basename}`,
      `file=${this.basename}`,
    );
    // take out mono if the previous file was viewing the mono version in
    // case this file doesn't have a mono version
    tempWindowLocationHref = tempWindowLocationHref.replace("&mono=True", "");
    // Find the position of "&commit=" in the string

    const index = tempWindowLocationHref.indexOf("&commit=");

    // If "&commit=" is found, remove everything after it
    if (index !== -1) {
      tempWindowLocationHref = tempWindowLocationHref.substring(0, index);
    }

    window.location.href = tempWindowLocationHref;
  }
};

var Stat = class Stat extends TreeItem {
  /**
   * An object containing all `Stat`s by their id.
   * Key is id, value is corresponding `Stat`:  {id: `Stat`}
   * @type {Object.<string, Stat>}
   * @static
   */
  static byId = {};

  /**
   * @param {string} id - The unique identifier to give the `Stat`.
   * @param {?Object.<string, any>=} options - Options to customize the `Stat`.
   * @param {?TreeItem=} options.parent - The `TreeItem` that contains the item in its
   *      nested content.
   * @param {string=} options.text - The text to show in the item's span (and
   *      therefore in the tree). If `null`, `id` is used.
   * @param {boolean} [options.removable=true] - Indicates if the item can be removed
   *      from the tree.
   * @throws {Error} If a `TreeItem` with `id` already exists.
   */
  constructor(id, { parent = null, text = null, saveable = true } = {}) {
    super(id, { parent, text, saveable });
    this.checkbox.type = "hidden";
  }

  style() {
    if (this.rendered) {
      this.li.style.fontSize = "8px";
      this.span.style.whiteSpace = "pre";
      this.span.style.fontFamily = "monospace";
    }
  }
};

TreeItem.types = {
  TreeItem,
  Group,
  CarouselGroup,
  PeaksItem,
  Segment,
  Point,
  Word,
  PeaksGroup,
  Face,
  File,
  Stat,
};

export {
  TreeItem,
  Popup,
  Group,
  CarouselGroup,
  PeaksItem,
  Segment,
  Point,
  Word,
  PeaksGroup,
  Face,
  File,
  Stat,
};
