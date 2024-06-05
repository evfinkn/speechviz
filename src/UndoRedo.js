import globals from "./globals.js";
import { redoIcon, undoIcon } from "./icon.js";
import { toggleButton } from "./util.js";

const filename = globals.filename;
const fileParagraph = document.getElementById("file");

const undoButton = document.getElementById("undo");
const redoButton = document.getElementById("redo");
undoButton.innerHTML = undoIcon;
redoButton.innerHTML = redoIcon;
// when first initializing, there are no undos or redos so toggle buttons off
toggleButton(undoButton, false);
toggleButton(redoButton, false);

/**
 * An action that the user takes that causes a change in the program state.
 * @interface Action
 */
/**
 * Undoes this action.
 * @function
 * @name Action#undo
 */

/**
 * An `Array` subclass that stores changes so that they can be undone.
 * @extends Array
 */
const UndoStorage = class UndoStorage extends Array {
  push(...items) {
    super.push(...items);
    if (this.length !== 0) {
      toggleButton(undoButton, true);
    }
    redoStorage.length = 0;
    toggleButton(redoButton, false);
    // If something was pushed to undo, that means an action that altered
    // something was taken, which means that the user now has unsaved changes
    // Therefore, remove the save indicator from the file name on the interface
    fileParagraph.innerHTML = filename;
    globals.dirty = true;
  }

  /** Undoes the most recently made change. */
  undo() {
    // even though undoButton should be unclickable
    // if the length is 0, make sure just in case
    if (this.length === 0) {
      return;
    }
    const action = this.pop();
    action.undo();
    redoStorage.push(action);
    if (this.length === 0) {
      toggleButton(undoButton, false);
    }
  }
};

/** The array holding the actions that have been taken and can be undone. */
const undoStorage = new UndoStorage();

// arrow function so that in undo(), `this` refers to undoStorage and not undoButton
undoButton.addEventListener("click", () => undoStorage.undo());

const RedoStorage = class RedoStorage extends Array {
  push(...items) {
    super.push(...items);
    if (this.length !== 0) {
      toggleButton(redoButton, true);
    }
  }

  redo() {
    // even though undoButton should be unclickable
    // if the length is 0, make sure just in case
    if (this.length === 0) {
      return;
    }
    const action = this.pop();
    action.redo();
    undoStorage.push(action);
    if (this.length === 0) {
      toggleButton(redoButton, false);
    }
  }
};

// use var for hoisting (so it can be referenced in UndoStorage push and undo)
/** The array holding the actions that have */
var redoStorage = new RedoStorage();

// arrow function so that in redo(), `this` refers to redoStorage and not redoButton
redoButton.addEventListener("click", () => redoStorage.redo());

// FIXME: unlike the other actions, this one doesn't actually do the initial action
//        (it gets passed the item that was added). is this elegantly fixable?
const AddAction = class AddAction {
  /** @type {!TreeItem} */ item;
  /** @type {!TreeItem} */ parent;
  /** @type {!Array.<AddAction>} */ children;

  /**
   * @param {!TreeItem} item -
   */
  constructor(item) {
    this.item = item;
    this.parent = item.parent;
    this.children = item.children.map((child) => new AddAction(child));
  }

  undo() {
    this.children.forEach((child) => child.undo());
    this.item.remove();
  }

  redo() {
    this.item.readd(this.parent);
    this.children.forEach((child) => child.redo());
  }
};

// TODO: this code is 99% the same as AddAction, so refactor
//       maybe some actions use an inverse Action (only some because
//       some are their own inverses though)
const RemoveAction = class RemoveAction {
  /** @type {!TreeItem} */ item;
  /** @type {!TreeItem} */ parent;
  /** @type {!Array.<RemoveAction>} */ children;

  /**
   * @param {!TreeItem} item -
   */
  constructor(item) {
    this.item = item;
    this.parent = item.parent;
    this.children = item.children.map((child) => new RemoveAction(child));
    item.remove();
  }

  undo() {
    this.item.readd(this.parent);
    this.children.forEach((child) => child.undo());
  }

  redo() {
    this.children.forEach((child) => child.redo());
    this.item.remove();
  }
};

const MoveAction = class MoveAction {
  /** @type {!TreeItem} */ item;
  /** @type {!TreeItem} */ oldParent;
  /** @type {!TreeItem} */ newParent;

  /**
   * @param {!TreeItem} item -
   * @param {!TreeItem} newParent -
   */
  constructor(item, newParent) {
    this.item = item;
    this.oldParent = item.parent;
    this.newParent = newParent;
    item.move(newParent);
  }

  undo() {
    this.item.move(this.oldParent);
  }

  redo() {
    this.item.move(this.newParent);
  }
};

const CopyAction = class CopyAction {
  /** @type {!Array.<AddAction>} */ copied;

  /**
   * @param {(!TreeItem|!Array.<TreeItem>)} copied -
   */
  constructor(copied) {
    if (!Array.isArray(copied)) {
      copied = [copied];
    }
    this.copied = copied.map((copy) => new AddAction(copy));
  }

  undo() {
    this.copied.forEach((copy) => copy.undo());
  }

  redo() {
    this.copied.forEach((copy) => copy.redo());
  }
};

const RenameAction = class RenameAction {
  /** @type {!TreeItem} */ item;
  /** @type {string} */ oldText;
  /** @type {string} */ newText;

  /**
   * @param {!TreeItem} item -
   * @param {string} newText -
   */
  constructor(item, newText) {
    this.item = item;
    this.oldText = item.text;
    this.newText = newText;
    this.item.rename(this.newText);
  }

  undo() {
    this.item.rename(this.oldText);
  }

  redo() {
    this.item.rename(this.newText);
  }
};

const DragSegmentAction = class DraggedSegmentAction {
  /** @type {!Segment} */ segment;
  /** @type {number} */ oldStartTime;
  /** @type {number} */ oldEndTime;
  /** @type {number} */ newStartTime;
  /** @type {number} */ newEndTime;

  constructor(segment, oldStartTime, oldEndTime) {
    this.segment = segment;
    this.oldStartTime = oldStartTime;
    this.oldEndTime = oldEndTime;
    this.newStartTime = segment.startTime;
    this.newEndTime = segment.endTime;
    segment.updateDuration();
  }

  #updateTimes(startTime, endTime) {
    this.segment.update({ startTime, endTime });
    this.segment.updateDuration();
  }

  undo() {
    this.#updateTimes(this.oldStartTime, this.oldEndTime);
  }

  redo() {
    this.#updateTimes(this.newStartTime, this.newEndTime);
  }
};

const AssociateAction = class AssociateAction {
  /** @type {!Face} */ face;
  /** @type {!PeaksGroup} */ speaker;

  constructor(face, speaker) {
    this.face = face;
    this.speaker = speaker;
    face.assoc(speaker);
  }

  undo() {
    this.face.unassoc();
  }

  redo() {
    this.face.assoc(this.speaker);
  }
};

const UnassociateAction = class UnassociateAction {
  /** @type {!Face} */ face;
  /** @type {!TreeItem} */ speaker;

  constructor(face) {
    this.face = face;
    this.speaker = face.speaker;
    face.unassoc();
  }

  undo() {
    this.face.assoc(this.speaker);
  }

  redo() {
    this.face.unassoc();
  }
};

const FaceCheckAction = class FaceCheckAction {
  /** @type {!Int} */ chunk;
  /** @type {!Array.<Int>} */ groups;

  /**
   * @param {!TreeItem} item -
   */
  constructor(chunk, groups) {
    this.chunk = chunk;
    this.groups = groups;
    // TODO: implement actually storing what groups are the active
    // speaker for a given chunk
  }

  undo() {
    // TODO: implement
  }

  redo() {
    // TODO: implement
  }
};

const ColorAction = class ColorAction {
  /** @type {!TreeItem} */ item;
  /** @type {!Color} */ oldColor;
  /** @type {!Color} */ newColor;

  constructor(item, newColor) {
    this.item = item;
    this.oldColor = item.color;
    this.newColor = newColor;
    item.color = newColor;
  }

  undo() {
    this.item.color = this.oldColor;
  }

  redo() {
    this.item.color = this.newColor;
  }
};

const SplitSegmentAction = class SplitSegmentAction {
  /** @type {!Segment} */ ogSegment;
  /** @type {!Segment} */ newSegment;

  constructor(segment) {
    this.ogSegment = segment;
    this.newSegment = segment.split();
  }

  undo() {
    this.ogSegment.update({ endTime: this.newSegment.endTime });
    this.newSegment.remove();
  }

  redo() {
    this.newSegment = this.ogSegment.split();
  }
};

const MergeSegmentsAction = class MergeSegmentsAction {
  /** @type {!Segment} */ segment;
  /** @type {number} */ oldStartTime;
  /** @type {number} */ oldEndTime;
  /** @type {!Array.<Segment>} */ overlapping;

  constructor(segment) {
    this.segment = segment;
    this.oldStartTime = segment.startTime;
    this.oldEndTime = segment.endTime;
    this.overlapping = segment.parent.getOverlapping(segment);
    segment.merge(...this.overlapping);
  }

  undo() {
    this.segment.update({
      startTime: this.oldStartTime,
      endTime: this.oldEndTime,
    });
    this.overlapping.forEach((segment) => segment.readd(this.segment.parent));
  }

  redo() {
    this.segment.merge(...this.overlapping);
  }
};

/**
 * An enum containing every type of `Action`.
 * @type {!Object.<string, Action>}
 */
const Actions = {
  AddAction,
  RemoveAction,
  MoveAction,
  CopyAction,
  RenameAction,
  DragSegmentAction,
  AssociateAction,
  UnassociateAction,
  ColorAction,
  SplitSegmentAction,
  MergeSegmentsAction,
  FaceCheckAction,
};

export { undoStorage, redoStorage, Actions };
