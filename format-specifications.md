# Format specifications

This file gives the specification of the format that `-annotations.json` files use.
Said files contain the tree items that are imported into the interface.

## Version 3

This version is mostly the same as version 2, except that the array of tree items has been moved to the `annotations` property of an object with a `formatVersion` property.

```json
{
  "formatVersion": 3,
  // array of tree items in the same format as version 2
  "annotations": []
}
```

## Version 2

The file contains an array of objects representing tree items.

```json
[
  {
    // The type of the tree item. See src/treeClasses.js for valid types.
    "type": "",
    // The arguments to pass to the constructor of the tree item's class, excluding
    // the options object.
    "arguments": [],
    /*
     * The options passed as the last argument to the constructor of this tree
     * item's class. For example, the last argument to TreeItem is an object with
     * options like `text` and `removable`. Any option that takes some form of
     * TreeItem as a value should be passed as the id of the TreeItem. Besides
     * `parent`, `moveTo` and `copyTo` are examples of such options, being arrays of
     * TreeItem ids. If new options like this are added, the constructor should
     * of that type either 1. handle the conversion from id to TreeItem itself or
     * 2. accept the ids temporarily and let the caller of `createTreeItemFromObj`
     * fix it after the tree item is created. The latter is usually necessary,
     * since some of the TreeItems being referenced might not have been created yet.
     *
     * Each option provided below is optional and is included to give additional
     * information on how it is used and what is valid.
     */
    "options": {
      /*
       * The id of the parent tree item. Mostly only useful for direct children
       * of the root tree item, `"Analysis"`, since items defined in a tree item's
       * `children` property will have their parent set to that tree item
       * automatically.
       */
      "parent": "",
      /*
       * For tree items that can have children, an array of tree item objects
       * representing the children. The children aren't passed to the constructor
       * of the tree item's class but are instead created after the tree item is
       * created.
       */
      "children": [],
      /*
       * This is a special option and is not passed to the constructor.
       * For tree items that can have children, an object whose properties are
       * options to pass to the constructor of the tree item's class for each
       * child. This is useful for when all the children share one or more
       * options. The options are overridden by the `options` property of each
       * child if defined there. The property can be nested within itself.
       * E.g., "childrenOptions": {"childrenOptions": {"playable": true}} will
       * make all grandchildren playable.
       */
      "childrenOptions": {}
    }
  }
]
```

## Version 1

A file using this format contains an array of group arrays. A group array has the
following format:

```json
[
  "", // id
  [], // array of either group arrays or segment objects (see below)
  0.0 // optional float value representing the SNR of the group
]
```

A segment object has the following format:

```json
{
  "startTime": 0.0,
  "endTime": 0.0,
  "color": "#rrggbb",
  "labelText": ""
}
```
