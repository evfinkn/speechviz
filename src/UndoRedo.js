import globals from "./globals";
import { TreeItem, Segment, PeaksGroup } from "./treeClasses";

const peaks = globals.peaks;
const fileParagraph = document.getElementById("file");
const saveStatusRegex = / - Saved| - Error while saving/;

/**
 * A `Array` subclass that stores changes so that they can be undone.
 * @extends Array
 */
const UndoStorage = class UndoStorage extends Array {
  push(...items) {
    super.push(...items);
    // redoStorage.length = 0;  // clear redos
    // If something was pushed to undo, that means an action that altered
    // something was taken, which means that the user now has unsaved changes
    // Therefore, remove the save indicator from the file name on the interface
    fileParagraph.innerHTML = fileParagraph.innerHTML.replace(
      saveStatusRegex,
      ""
    );
  }

  // TODO: make Action / Change classes for each undo that handles that specific undo
  // TODO: resort a group after re-adding segments to it
  /** Undoes the most recently made change. */
  undo() {
    if (this.length == 0) {
      return;
    }
    const undoThing = super.pop();
    if (undoThing[0] == "deleted segment") {
      // unpack undoThing (ignoring first element)
      const [, peaksSegment, options] = undoThing;
      Object.assign(options, { parent: TreeItem.byId[options.path.at(-1)] });
      const segment = new Segment(peaks.segments.add(peaksSegment), options);
      segment.parent.sort("startTime");
    } else if (undoThing[0] == "deleted group") {
      // unpack undoThing (ignoring first element)
      const [, id, options] = undoThing;
      Object.assign(options, { parent: TreeItem.byId[options.path.at(-1)] });
      new PeaksGroup(id, options);
      while (
        this.length != 0 &&
        this.at(-1)[0] == "deleted segment" &&
        this.at(-1)[3]
      ) {
        this.undo();
      }
    } else if (undoThing[0] == "moved") {
      const parent = TreeItem.byId[undoThing[2]];
      TreeItem.byId[undoThing[1]].parent = parent;
      parent.sort("startTime");
    } else if (undoThing[0] == "copied") {
      while (undoThing[1].length != 0) {
        TreeItem.byId[undoThing[1].pop()].remove();
      }
    } else if (undoThing[0] == "renamed") {
      TreeItem.byId[undoThing[1]].rename(undoThing[2]);
    } else if (undoThing[0] == "dragged") {
      Segment.byId[undoThing[1]].endTime = undoThing[2];
      Segment.byId[undoThing[1]].startTime = undoThing[3];
      Segment.byId[undoThing[1]].updateDuration();
    } else if (undoThing[0] == "added segment") {
      Segment.byId[undoThing[1].id].remove();
    } else {
      console.log("SOME OTHER CASE FOR UNDOTHING HAS COME OUT");
      console.log(undoThing[0]);
    }
  }
};

/** The array holding the actions that have been undone. */
const undoStorage = new UndoStorage();

export { undoStorage };
