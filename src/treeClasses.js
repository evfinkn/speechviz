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
import globals from "./globals.js";
import { undoStorage, Actions } from "./UndoRedo.js";
import {
  htmlToElement,
  sortByProp,
  toggleButton,
  propertiesEqual,
  getRandomColor,
} from "./util.js";
import { groupIcons, segmentIcons } from "./icon.js";

const media = globals.media;
const peaks = globals.peaks;

// typedefs (used for JSDoc, can help explain types)
/**
 * A hex string in the form "#RRGGBB" that represents a color.
 * @typedef {string} Color
 */

// TODO: make typedef for an options type

// FIXME: completely remove this and the expand methods and instead make moveTo and
//        copyTo arrays of TreeItems, and just update copyTo after all of the speakers
//        have been added. To solve moving to labels, just push Labeled.children
//        in moveTo / copyTo and then flatten moveTo / copyTo when the popup is shown
/**
 * Expands an array consisting of `Group`s and `GroupOfGroups` by recursively replacing
 * `GroupOfGroups` with their children until all items are `Group`s.
 * @param {(!Array.<Group|GroupOfGroups>)} groups - Array of `Group`s and
 *      `GroupOfGroups`s to expand.
 * @param {?Array.<Group>=} exclude - Array of `Group`s to exclude from the expanded
 *      array.
 * @returns {!Array.<Group>} The expanded array of `Group`s.
 */
const expandGroups = function expand(groups, exclude = []) {
  const expanded = [];
  for (const group of groups) {
    if (group instanceof PeaksGroup) {
      if (!exclude.includes(group.id)) {
        expanded.push(group);
      }
    }
    // array.push(...) is faster than array.concat()
    else {
      expanded.push(...expandGroups(group.children, exclude));
    }
  }
  return expanded;
};

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
   * Names of properties to get in `getProperties`.
   * @type {!string[]}
   * @see getProperties
   * @static
   */
  static properties = [
    "id",
    "text",
    "duration",
    "removable",
    "renamable",
    "path",
  ];

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

  /**
   * Returns an array of `TreeItem`s with the given ids.
   * @param {!string[]} ids - Array of the ids of the `TreeItem`s to get.
   * @returns {!TreeItem[]} The `TreeItem`s corresponding to the ids.
   * @static
   */
  static idsToTreeItems(ids) {
    return ids.map((id) => TreeItem.byId[id]);
  }

  /**
   * Returns an array of the ids of the given `TreeItem`s.
   * @param {!TreeItem[]} treeItems - Array of the `TreeItem`s whose ids to get.
   * @returns {!string[]} The ids corresponding to the given `TreeItem`s.
   * @static
   */
  static treeItemsToIds(treeItems) {
    return treeItems.map((treeItem) => treeItem.id);
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
   * This is hidden to differentiate between the getter and setter for `text`.
   * Can probably be removed by just changing getter and setter for `text` to only use
   * `span.innerHTML`.
   * @type {string}
   */
  #text;

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

  // array of ids instead of TreeItems because some might be expanded
  // e.g. Segments and Groups aren't movable to GroupOfGroups, but can be movable
  // any child of a GroupOfGroups. Therefore, need to store id so that GroupOfGroups
  // can be expanded into Groups (the expansion of which will depend on when it's
  // being expanded e.g. labels are added)
  /**
   * An array of the ids of `TreeItem`s that this item can be moved to.
   * `null` if this item isn't moveable.
   * @type {?string[]}
   */
  moveTo = null;

  /**
   * An array of the ids of `TreeItem`s that this item can be copied to.
   * `null` if this item isn't copyable.
   * @type {?string[]}
   */
  copyTo = null;

  /**
   * An array of the ids of `TreeItem`s that this Face can be associated with.
   * `null` if there are no such `TreeItem`s
   * @type {?string[]}
   */
  assocWith;

  /**
   * The li element that is displayed and that contains all other elements.
   * @type {!Element}
   */
  li;

  /**
   * The input element of the checkbox used to toggle this item.
   * @type {!Element}
   */
  checkbox;

  /**
   * The span element containing the text shown in `li`.
   * @type {!Element}
   */
  span;

  /**
   * The a element of the play button if this item is playable. Otherwise, `null`.
   * @type {?Element}
   */
  playButton = null;

  /**
   * The a element of the loop button if this item is playable. Otherwise, `null`.
   * @type {?Element}
   */
  loopButton = null;

  /**
   * The a element of the pause button if this item is playable. Otherwise, `null`.
   * The play and loop buttons are switched out with this when they're clicked,
   * so it's only displayed when the item is playing.
   * @type {?Element}
   */
  pauseButton = null;

  /**
   * The a element of the remove button.
   * `null` if this item isn't removable.
   * @type {?Element}
   */
  removeButton = null;

  /**
   * The `Popup` that is shown when this item (specifically `span`) is clicked.
   * `null` if this item doesn't have any properties shown in a `Popup`.
   * @type {?Popup}
   */
  popup = null;

  /**
   * The ul element containing the nested content (the children) of this item.
   * @type {!Element}
   */
  nested;

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
   * @param {?Array.<string>=} [options.moveTo] - An array of the ids of `TreeItem`s
   *      that the item can be moved to. `null` if the item isn't moveable.
   * @param {?Array.<string>=} [options.copyTo] - An array of the ids of `TreeItem`s
   *      that the item can be copied to. `null` if the item isn't copyable.
   * @param {boolean} [options.render=true] - If `true`, `render()` is called in
   *      the constructor. Otherwise, `render()` is not called and is left to the
   *      user to call.
   * @param {?Array.<string>=} [options.assocWith] - An array of the ids of `TreeItem`s
   *      that the item can be associated with. `null` if the item isn't moveable.
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
    } = {}
  ) {
    this.id = id;
    this.addToById();

    this.#text = text || id;
    this.playable = playable;
    this.duration = playable ? 0 : null;
    this.removable = removable;
    this.renamable = renamable;
    this.moveTo = moveTo;
    this.copyTo = copyTo;
    this.assocWith = assocWith;

    if (render) {
      this.render();
      // in if (render) because you can only assign to parent if its been rendered,
      // since this.li is appended to parent.nested but this.li is set in render
      if (parent) {
        parent.addChildren(this);
      }
    }

    if (children) {
      this.addChildren(...children);
    }
  }

  // https://stackoverflow.com/a/68374307
  /**
   * Gets every constructor used to construct `this`.
   * In other words, gets `this`' class and all of its superclasses.
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

  /**
   * The text shown in `span` (and therefore in the tree).
   * @type {string}
   */
  get text() {
    return this.#text;
  }
  set text(newText) {
    // setter for text so `this.text = newText` updates text in tree
    this.#text = newText;
    this.span.innerHTML = newText;
  }

  /**
   * A `boolean` indicating if this item's checkbox is checked.
   * Equivalent to `checkbox.checked`.
   * @type {boolean}
   */
  get checked() {
    return this.checkbox.checked;
  }
  set checked(bool) {
    this.checkbox.checked = bool;
  }

  /**
   * `null` if this item doesn't have a parent. Otherwise, an array containing this
   * item's parent, this item's parent's parent, etc. Top-most parents are first in
   * the array, with this item's parent being last. For example,
   * `[root, great-grandparent, grandparent, parent]`.
   * @type {?Array.<TreeItem>}
   */
  get path() {
    if (this.parent) {
      const parentPath = this.parent.path;
      if (parentPath) {
        parentPath.push(this.parent.id);
        return parentPath; // path is parent's path + parent
      }
      return [this.parent.id]; // parent has no path, so path is just parent
    }
    return null; // no parent, so no path
  }

  /**
   * Gets the properties of this item specified by `properties`.
   * @param {?Array.<string>=} exclude - Names of properties to exclude from the
   *      returned `Object`.
   * @returns {!Object.<string, any>} An `Object` containing this item's properties.
   * @see properties
   */
  getProperties(exclude = null) {
    exclude = exclude == null ? [] : exclude;
    const obj = {};
    TreeItem.properties.forEach((property) => {
      if (!exclude.includes(property)) {
        obj[property] = this[property];
      }
    });
    if (!(this.constructor == TreeItem)) {
      this.constructor.properties.forEach((property) => {
        if (!exclude.includes(property)) {
          obj[property] = this[property];
        }
      });
    }
    return obj;
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
      this.nested.append(child.li);
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
    // FIXME: make ids a Set??
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
    if (this.playButton && this.loopButton && this.pauseButton) {
      return; // this item has already been made playable
    }

    this.playable = true;
    this.duration = 0;

    this.playButton = htmlToElement(
      `<a href="javascript:;" class="button-on">${this.constructor.icons.play}</a>`
    );
    // use () => this.play() instead of just this.play so that
    // "this" refers to the TreeItem and not the button getting clicked
    this.playButton.addEventListener("click", () => this.play());
    // this puts the play button before any other buttons
    this.span.after(this.playButton);

    this.loopButton = htmlToElement(
      `<a href="javascript:;" class="button-on">${this.constructor.icons.loop}</a>`
    );
    // need to use () => so that we can pass loop = true
    this.loopButton.addEventListener("click", () => this.play(true));
    this.playButton.after(this.loopButton);

    this.pauseButton = htmlToElement(
      `<a href="javascript:;" class="button-on">${this.constructor.icons.pause}</a>`
    );
    this.pauseButton.addEventListener("click", () => this.pause());
  }

  /**
   * Adds a remove button to this item.
   * This also sets `this.removable` to `true`.
   */
  makeRemovable() {
    if (this.removeButton) {
      return; // this item has already been made removable
    }

    this.removable = true;

    this.removeButton = htmlToElement(
      `<a href="javascript:;" class="button-on">${this.constructor.icons.remove}</a>`
    );
    this.removeButton.addEventListener("click", () => {
      undoStorage.push(new Actions.RemoveAction(this));
    });
    // this puts the remove button after any other buttons
    this.nested.before(this.removeButton);
  }

  /** Generates the HTML for this item. */
  render() {
    if (this.li) {
      this.li.remove();
    }

    // since subclasses use this method, use this.constructor.icons to use the icons of
    // whatever class is being initialized (i.e. Group, TreeItem, Segment, etc.)
    const li = htmlToElement(`<li>
            <input type="checkbox" autocomplete="off" checked>
            <span>${this.#text}</span>
            <ul class="nested active"></ul>
        </li>`);
    this.li = li;

    this.checkbox = li.children[0];
    // event listeners need to use `() => {}` syntax instead of `function () {}` because
    // `() => {}` doesn't rebind `this` (`this` will still refer to the TreeItem)
    this.checkbox.addEventListener("click", () => {
      this.toggle();
    });

    this.span = li.children[1];
    this.span.addEventListener("click", () => {
      // TODO: move popup to TreeItem constructor?
      if (this.popup) {
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
      this.updateSpanTitle();

      if (this.parent) {
        this.parent.updateDuration(durationChange);
      }
    }
  }

  /** Updates the title (tooltip) of `span`. */
  updateSpanTitle() {
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
    if (!this.playable) {
      throw new Error(
        `TreeItem ${this.id} is not playable and therefore has no buttons to switch.`
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
    if (!this.playable) {
      throw new Error(
        `TreeItem ${this.id} is not playable and therefore has no buttons to switch.`
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

    this.li.remove();
    this.removeFromById();
    this.children.forEach(function (child) {
      child.remove();
    });
    if (this.parent) {
      // TODO: make children a set of item or map of id to item
      this.parent.removeChildren(this);
    }
  }

  /**
   * Readds this item.
   * To be specific, adds this item to `byId` and `parent` if not `null`. If `parent`
   * is `null` and `this.parent` isn't, `this.parent` is used instead. Otherwise, if
   * both are `null`, this item isn't added to any parent.
   * @param {?TreeItem} parent - The `TreeItem` to add this item to, if any.
   */
  readd(parent = null) {
    this.addToById(); // will throw an error if one already exists !
    if (parent !== null) {
      parent.addChildren(this);
    } else if (this.parent !== null) {
      this.parent.addChildren(this);
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
   * Sorts this item's children in the tree.
   * @param {string} by - The name of the property to sort by.
   */
  sort(by) {
    const nested = this.nested;
    const children = sortByProp(this.children, by);
    children.forEach(function (segment) {
      nested.append(segment.li);
    });
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

    const checked = force === null ? this.checked : force;
    this.checked = checked;

    this.nested.classList.toggle("active", checked);

    if (this.playButton) {
      toggleButton(this.playButton, checked);
      toggleButton(this.loopButton, checked);
    }
    if (this.removeButton) {
      toggleButton(this.removeButton, checked);
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
    this.nested.classList.add("active");
    this.checked = true;
    if (this.parent) {
      this.parent.open();
    }
  }

  // The following 3 methods implement the EventTarget interface
  // https://developer.mozilla.org/en-US/docs/Web/API/EventTarget
  /**
   * Sets up a function that will be called whenever the specified event is
   * delivered to the target.
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener|EventTarget.addEventListener}
   */
  addEventListener(type, listener, options) {
    this.li.addEventListener(type, listener, options);
  }

  /**
   * Removes an event listener previously registered with `addEventListener`
   * from the target.
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener|EventTarget.removeEventListener}
   */
  removeEventListener(type, listener, options) {
    this.li.removeEventListener(type, listener, options);
  }

  /**
   * Sends an `Event` to this item, invoking the affected `EventListeners`.
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/dispatchEvent|EventTarget.dispatchEvent}
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
   * @type {!Element}
   */
  popup;

  // Honestly I'm not sure why popup and popupContent are separate, that's just the way
  // Sarita made it, so that's how I made the class. They might be able to be combined
  /**
   * The div element containing the actual content of the popup.
   * @type {!Element}
   */
  popupContent;

  /**
   * The div element containing `renameInput` if `treeItem.renamable`.
   * Otherwise, `null`.
   * @type {?Element}
   */
  renameDiv = null;

  /**
   * The text input element used to rename `treeItem` if `treeItem.renamable`.
   * Otherwise, `null`.
   * @type {?Element}
   */
  renameInput = null;

  /**
   * The div element containing the radio buttons used to move `treeItem`
   * if `treeItem.moveTo`. Otherwise, `null`.
   * @type {?Element}
   */
  moveDiv = null;

  /**
   * The div element containing the radio buttons used to copy `treeItem`
   * if `treeItem.copyTo`. Otherwise, `null`.
   * @type {?Element}
   */
  copyDiv = null;

  /**
   * The div element containing the radio buttons used to associate
   * `treeItem` if `treeItem.assocWith`.
   * Otherwise, `null`.
   * @type {?Element}
   */
  assocDiv = null;

  /**
   * The div element containing `colorPicker` if `treeItem.colorable`.
   * Otherwise, `null`.
   * @type {?Element}
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
   * @type {?Element}
   */
  randomColorButton = null;

  /**
   * @param {!TreeItem} treeItem - The `TreeItem` to create the `Popup` for.
   */
  constructor(treeItem) {
    this.popup = htmlToElement("<div class='popup'></div>");

    const popupContent = htmlToElement("<div class='popup-content'></div>");
    this.popupContent = popupContent;
    this.popup.appendChild(popupContent);

    this.treeItem = treeItem;
    treeItem.li.append(this.popup);

    const text = treeItem.text;
    this.#text = text; // set this.#text and not this.text so it doesn't call setter

    const closeButton = htmlToElement("<a class='close'>&times</a>");
    popupContent.appendChild(closeButton);
    closeButton.addEventListener("click", () => this.hide());

    if (treeItem.renamable) {
      const renameDiv = htmlToElement(`<div><h3>Rename ${text}</h3></div>`);
      this.renameDiv = renameDiv;
      const renameInput = htmlToElement(`<input type="text" value="${text}">`);
      this.renameInput = renameInput;
      renameDiv.append(renameInput);
      renameInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          undoStorage.push(
            new Actions.RenameAction(treeItem, renameInput.value)
          );
          this.hide();
        }
      });
      popupContent.append(renameDiv);
    }

    if (treeItem.moveTo) {
      popupContent.append(document.createElement("br"));
      this.moveDiv = htmlToElement(
        `<div><h3>Move ${text} to another group</h3></div>`
      );
      popupContent.append(this.moveDiv);
    }

    if (treeItem.copyTo) {
      popupContent.append(document.createElement("br"));
      this.copyDiv = htmlToElement(
        `<div><h3>Copy ${text} to another group</h3></div>`
      );
      popupContent.append(this.copyDiv);
    }

    if (treeItem.assocWith) {
      popupContent.append(document.createElement("br"));
      this.assocDiv = htmlToElement(
        `<div><h3>Associate ${text} with a speaker</h3></div>`
      );
      popupContent.append(this.assocDiv);
    }

    if (treeItem.colorable) {
      const colorDiv = htmlToElement(
        `<div><h3>Pick a new color for ${text}</h3></div>`
      );
      this.colorDiv = colorDiv;
      const colorPicker = new Picker({
        parent: colorDiv,
        popup: false,
        alpha: false,
      });
      this.colorPicker = colorPicker;
      colorPicker.onDone = (color) => {
        treeItem.color = color.hex.substring(0, 7);
        this.hide();
      };

      const randomColorButton = htmlToElement(
        "<button>Set to random color</button>"
      );
      this.randomColorButton = randomColorButton;
      colorDiv.append(randomColorButton);
      randomColorButton.addEventListener("click", () => {
        const randomColor = getRandomColor();
        treeItem.color = randomColor;
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
    const moveTo = this.treeItem.expandMoveTo();
    if (moveTo.length == 0) {
      moveDiv.hidden = true;
    } else {
      moveDiv.hidden = false;
      moveTo.forEach((destId) => {
        // Sometimes the TreeItem we want to move to hasn't been initialized yet,
        // so add a check to only add radios for initialized TreeItems.
        // For example, the segments for the speakers can be moved between each other,
        // so when Speaker 1's segments are being initialized they'll say they can be
        // moved to Speaker 2 which doesn't exist yet, so it'll throw an error
        const dest = TreeItem.byId[destId];
        if (dest !== undefined) {
          this.addMoveRadio(dest);
        }
      });
    }
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
    const copyTo = this.treeItem.expandCopyTo();
    if (copyTo.length == 0) {
      copyDiv.hidden = true;
    } else {
      copyDiv.hidden = false;
      copyTo.forEach((destId) => {
        const dest = TreeItem.byId[destId];
        if (dest !== undefined) {
          this.addCopyRadio(dest);
        }
      });
    }
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
    const assocWith = this.treeItem.expandAssocWith();
    if (assocWith.length == 0) {
      assocDiv.hidden = true;
    } else {
      assocDiv.hidden = false;
      assocWith.forEach((destId) => {
        const dest = TreeItem.byId[destId];
        if (dest !== undefined && dest.faceNum === null) {
          this.addAssocRadio(dest);
        }
      });
    }
  }

  /**
   * Adds a radio button used to move `treeItem`.
   * @param {string} destId - The id of the `TreeItem` to move `treeItem` to
   *      when the radio button is clicked.
   */
  addMoveRadio(dest) {
    const radioDiv = htmlToElement(
      "<div><label>" +
        `<input type="radio" name="${this.treeItem.id}-radios"` +
        `autocomplete="off"> ${dest.id}</label><br></div>`
    );
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
   * @param {string} destId - The id of the `TreeItem` to copy `treeItem` to
   *      when the radio button is clicked.
   */
  addCopyRadio(dest) {
    const radioDiv = htmlToElement(
      "<div><label>" +
        `<input type="radio" name="${this.treeItem.id}-radios"` +
        `autocomplete="off"> ${dest.id}</label><br></div>`
    );
    const radioButton = radioDiv.firstElementChild.firstElementChild;

    this.copyDiv.append(radioDiv);

    radioButton.addEventListener("change", () => {
      const copied = this.treeItem.copy(dest);
      if (copied) {
        undoStorage.push(new Actions.CopyAction(copied));
        dest.sort("startTime");
      }
      dest.open();
      radioButton.checked = false;
      this.hide();
    });
  }

  /**
   * Adds a radio button used to associate the `Face` with a `TreeItem`.
   * @param {TreeItem} dest - The `TreeItem` to associate the `Face` to
   *      when the radio button is clicked.
   */
  addAssocRadio(dest) {
    const radioDiv = htmlToElement(
      "<div><label>" +
        `<input type="radio" name="${this.treeItem.id}-radios"` +
        `autocomplete="off"> ${dest.id}</label><br></div>`
    );
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
    } = {}
  ) {
    super(id, { parent, children, text, playable, removable, moveTo, copyTo });
  }

  /** Sets the CSS styling of the group's elements. */
  style() {
    this.li.style.fontSize = "18px";
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
    const checked = force === null ? this.checked : force;
    this.children.forEach(function (child) {
      child.toggle(checked);
    });
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
      // get children inside the loop because user may have checked more tree items
      const children = sortByProp(
        this.children.filter((child) => child.checked && child.playable),
        "startTime"
      );
      if (children.length === 0) {
        // there's nothing to play, so stop the iterator completely using return
        // return will set the done property of generator.next() to true
        return;
      }
      for (const child of children) {
        // checked and playable are checked above, but they might've changed,
        // so check again just to ensure that the child is still valid
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
        { once: true }
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
        `Group ${this.id} is not playable and therefore can't be paused.`
      );
    }

    // dispatch manualpause to let the event listener added in play handle pausing
    // this way, the endedHandler can be removed (we couldn't do it here because
    // it's not defined here)
    this.dispatchEvent(new Event("manualpause", { bubbles: true }));
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
        points.push(peaksItem).point;
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
   * @param {?PeaksGroup=} options.parent - The `Group` that contains the item in its
   *      nested content.
   * @param {string=} options.text - The text to show in the item's span (and
   *      therefore in the tree).
   * @param {boolean} [options.playable=false] - Indicates if the segment / point
   *      can be played.
   * @param {boolean} [options.removable=false] - Indicates if the segment / point
   *      can be removed from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the segment /point
   *      can be renamed.
   * @param {?Array.<string>=} options.moveTo - An array of the ids of `TreeItem`s that
   *      the item can be moved to. `null` if the group isn't moveable.
   * @param {?Array.<string>=} options.copyTo - An array of the ids of `TreeItem`s that
   *      the item can be copied to. `null` if the group isn't copyable.
   * @throws {Error} If a `TreeItem` with `segment.id` already exists.
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
    } = {}
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
    });
    this.peaksItem = peaksItem;
    this.type = peaksItem.constructor.name === "Segment" ? "Segment" : "Point";

    this.render();
    parent.addChildren(this);

    this.#editable = this.peaksItem.editable;
    this.currentlyEditable = this.peaksItem.editable;
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

  // TODO: rename this method (it doesn't feel right / fit with similar)
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
    this.li.style.fontSize = "12px";
    this.checkbox.style.transform = "scale(0.85)";
  }

  /** Removes this segment / point from the tree and Peaks waveform. */
  remove() {
    if (this.parent.visible.has(this)) {
      this.#removeFromPeaks();
    }
    super.remove();
  }

  /**
   * Readds this item.
   * To be specific, adds this item to `byId`, to Peaks, and to `parent` if not
   * `null`. If `parent` is `null` and `this.parent` isn't, `this.parent` is used
   * instead. Otherwise, if both are `null`, this item isn't added to any parent.
   * @param {?PeaksGroup} parent - The `PeaksGroup` to add this item to, if any.
   */
  readd(parent = null) {
    this.#addToPeaks();
    super.readd(parent);
  }

  // FIXME: make all rename methods throw error
  /**
   * Renames this Peaks.js item, replacing its id, text, and labelText.
   * @param {string} newId - The new id to give this item.
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

    const checked = force === null ? this.checked : force;
    if (checked) {
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

  /**
   * Converts `moveTo` to `TreeItem`s and expands the groups.
   * @see expandGroups
   */
  expandMoveTo() {
    const moveToAsTreeItems = TreeItem.idsToTreeItems(this.moveTo);
    const expanded = expandGroups(moveToAsTreeItems, [this.parent.id]);
    return TreeItem.treeItemsToIds(expanded);
  }

  /**
   * Converts `copyTo` to `TreeItem`s and expands the groups.
   * @see expandGroups
   */
  expandCopyTo() {
    const copyToAsTreeItems = TreeItem.idsToTreeItems(this.copyTo);
    const expanded = expandGroups(copyToAsTreeItems, [this.parent.id]);
    return TreeItem.treeItemsToIds(expanded);
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

  /**
   * Names of properties to get in `getProperties`.
   * @type {!Array.<string>}
   * @static
   */
  static properties = [
    "startTime",
    "endTime",
    "editable",
    "color",
    "labelText",
    "treeText",
  ];

  /**
   * @param {!PeaksSegment} segment - The Peaks segment being represented in the tree
   *      by the `Segment`.
   * @param {?Object.<string, any>=} options - Options to customize the segment.
   * @param {?Group=} options.parent - The `Group` that contains the segment in its
   *      nested content.
   * @param {string=} options.text - The text to show in the segment's span (and
   *      therefore in the tree).
   * @param {boolean} [options.removable=false] - Indicates if the segment can be
   *      removed from the tree.
   * @param {boolean} [options.renamable=false] - Indicates if the segment can be
   *      renamed.
   * @param {?Array.<string>=} options.moveTo - An array of the ids of `TreeItem`s that
   *      the segment can be moved to. `null` if the group isn't moveable.
   * @param {?Array.<string>=} options.copyTo - An array of the ids of `TreeItem`s that
   *      the segment can be copied to. `null` if the group isn't copyable.
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
    } = {}
  ) {
    super(segment, {
      parent,
      text,
      playable: true,
      removable,
      renamable,
      moveTo,
      copyTo,
    });

    this.updateDuration();

    // segment only needs a popup if it's renamable, movable, or copyable
    if (this.renamable || this.moveTo || this.copyTo) {
      this.popup = new Popup(this);
    }
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
  }

  /**
   * The text shown in `span` (and therefore in the tree).
   * @type {string}
   */
  get treeText() {
    return this.text;
  } // backwards compatibility (database expects 'treeText')

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
   * Copies this segment to another `Group`.
   * @param {!PeaksGroup} copyParent - `Group` to add the copied segment to.
   * @returns {?Segment} The copied segment if `copyParent` didn't already have a
   *      copy of this segment. Otherwise, `null`.
   */
  copy(copyParent) {
    // only copy if the new parent doesn't already have a copy of the segment
    if (
      !copyParent.children.some((child) =>
        propertiesEqual(this.segment, child.segment, ["startTime", "endTime"])
      )
    ) {
      const segment = this.segment;
      const newSegment = peaks.segments.add({
        startTime: segment.startTime,
        endTime: segment.endTime,
        editable: true,
      });
      return new Segment(newSegment, {
        parent: copyParent,
        text: this.text,
        removable: true,
        renamable: true,
        moveTo: ["Labeled"],
      });
    }
    return null;
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
   * Names of properties to get in `getProperties`.
   * @type {!Array.<string>}
   * @static
   */
  static properties = ["snr", "color", "colorable"];

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
   */
  faceNum = null;

  // FIXME: in every doc comment, decide when to use things like
  //        `PeaksGroup` / `Group` vs group and `Segment` vs segment
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
      removable = false,
      renamable = false,
      color = null,
      colorable = false,
      moveTo = null,
      copyTo = null,
    } = {}
  ) {
    // always have to call constructor for super class (TreeItem)
    super(id, {
      parent,
      children,
      text,
      playable: true,
      removable,
      renamable,
      moveTo,
      copyTo,
    });

    this.snr = snr;
    if (children) {
      this.sort("startTime");
    }

    if (color) {
      this.#color = color;
    }
    this.colorable = colorable;

    if (renamable || moveTo || copyTo || colorable) {
      this.popup = new Popup(this);
    }
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
    this.sort("startTime");
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
    if (this.snr && this.duration != 0) {
      this.span.title = `SNR: ${this.snr.toFixed(
        2
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
      peaksItem.rename(peaksItem.text)
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
    const checked = force === null ? this.checked : force;
    this.children.forEach((child) => child.toggleTree(checked));
    if (checked) {
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
   * Converts `moveTo` to `TreeItem`s and expands the groups.
   * @see expandGroups
   */
  expandMoveTo() {
    const moveToAsTreeItems = TreeItem.idsToTreeItems(this.moveTo);
    const expanded = expandGroups(moveToAsTreeItems, [this.id]);
    return TreeItem.treeItemsToIds(expanded);
  }

  /**
   * Converts `copyTo` to `TreeItem`s and expands the groups.
   * @see expandGroups
   */
  expandCopyTo() {
    const copyToAsTreeItems = TreeItem.idsToTreeItems(this.copyTo);
    const expanded = expandGroups(copyToAsTreeItems, [this.id]);
    return TreeItem.treeItemsToIds(expanded);
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
   * Path to image displayed for a face
   * @type {string}
   */
  imagePath;

  /**
   * Button that links to a page with every single face in this cluster
   * @type {string}
   */
  linkButton;

  /**
   * Li for the image shown for a face
   */
  imageLi;

  /**
   * Speaker number this face is associated with
   */
  speakerNum = null;

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
   * @param {?Array.<string>=} [options.assocWith] - An array of the ids of
   *      `TreeItem`s that Face can be associated with. `null` if the Face isn't able
   *      to be associated.
   * @param {string=} options.dir - The folder representing the clusters of faces for
   *      this video
   * @param {string=} options.imagePath - The name of the image shown for this face
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
      dir = null,
      imagePath = null,
    } = {}
  ) {
    // (can't use 'this' until after super() call,
    // so can't get rid of playButton, etc. until after super())
    super(id, {
      parent,
      text,
      removable,
      renamable,
      assocWith,
    });

    // rel="noopener noreferrer" is there to avoid tab nabbing
    this.linkButton = htmlToElement(
      `<a href="/clustered-faces?faceFolder=` +
        `${this.id}&inFaceFolder="true"` +
        ` style="text-decoration:none;"` +
        ` target="_blank" rel="noopener noreferrer"` +
        ` class="button-on">` +
        `${this.constructor.icons.image}</a>`
    );
    this.nested.before(this.linkButton);

    // change width and height here if you want a different sized image to show
    this.imageLi = htmlToElement(
      `<li><img src='faceClusters/${dir}/${id}/${imagePath}'` +
        ` width = 100 height = 100` +
        ` alt="Example image of face"/></li>`
    );
    // store previous html of image to reset its position when the image is clicked
    this.imageLi.addEventListener("click", () => {
      this.unassoc();
    });
    this.nested.appendChild(this.imageLi);
    this.popup = new Popup(this);
  }

  /** Initialize the CSS styling of the `Face` */
  style() {
    this.li.style.fontSize = "12px";
    this.checkbox.style.transform = "scale(0.85)";
  }

  /** Removes this `Face` from the tree and from Peaks */
  remove() {
    super.remove();
    // add something to move folder out of cluster to a "recycle bin"
  }

  /**
   * Associates this face with a `PeaksGroup`, displaying this face's image with the
   * group.
   * @param {PeaksGroup} speaker - The group to send this face's image to.
   */
  assoc(speaker) {
    this.speakerNum = speaker.id;
    speaker.faceNum = this.id;
    speaker.nested.before(this.imageLi);
  }

  /**
   * Unassociates this face from its `PeaksGroup` (if any), moving its image back
   * to this face's tree item.
   */
  unassoc() {
    this.nested.appendChild(this.imageLi);
    if (this.speakerNum !== null) {
      // TODO: Blake, is setting face on the PeaksGroup necessary? Just asking
      //       because I don't think PeaksGroup needs to know anything about Face
      PeaksGroup.byId[this.speakerNum].faceNum = null;
      this.speakerNum = null;
    }
  }

  /**
   * Converts `assocWith` to `TreeItem`s and expands the groups.
   */
  expandAssocWith() {
    const assocWithAsTreeItems = TreeItem.idsToTreeItems(this.assocWith);
    const expanded = expandGroups(assocWithAsTreeItems, [this.id]);
    return TreeItem.treeItemsToIds(expanded);
  }
};

export { TreeItem, Popup, Group, PeaksItem, Segment, PeaksGroup, Face };
