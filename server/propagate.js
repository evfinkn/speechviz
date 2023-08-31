const fs = require("fs");
const path = require("path");

const Papa = require("papaparse");

const fossil = require("./fossil");
const fossilUtil = require("./fossilUtil");

const dataDir = path.join(__dirname, "../data");

const write = (file, content) => {
  return new Promise((resolve, reject) => {
    // createWriteStream is used instead of writeFile for better performance
    const writeStream = fs.createWriteStream(file);
    writeStream.on("error", reject);
    writeStream.on("finish", resolve);
    writeStream.write(content);
    writeStream.end();
  });
};

const parseCsv = (readStream, config = {}) => {
  return new Promise((resolve, reject) => {
    if (config.complete) {
      // if complete is set, we need to wrap it so we can resolve the promise
      const complete = config.complete;
      config.complete = (results, file) => {
        complete(results, file);
        resolve(results);
      };
    } else {
      config.complete = resolve;
    }
    if (config.error) {
      // if error is set, we need to wrap it so we can reject the promise
      const error = config.error;
      config.error = (err, file) => {
        error(err, file);
        reject(err);
      };
    } else {
      config.error = reject;
    }
    Papa.parse(readStream, config);
  });
};

const getItemsById = (treeItem, exclude = null, itemsById = {}) => {
  // segments have an object with an id property as the first argument,
  // but other types like groups just have the id as the first argument
  if (treeItem.arguments === undefined) {
    console.log("in getItemsById, treeItem.arguments is undefined:");
    console.log(treeItem);
    return itemsById;
  }
  const id = treeItem.arguments[0]?.id ?? treeItem.arguments[0];
  if (!(typeof id === "string")) {
    return itemsById;
  }
  if (exclude === null) {
    itemsById[id] = treeItem;
    treeItem?.options?.children?.forEach((child) => {
      getItemsById(child, exclude, itemsById);
    });
  } else if (!exclude[id]) {
    itemsById[id] = treeItem;
  } else if (treeItem?.options?.children) {
    // only need to check children if this item isn't new (i.e., it's in exclude)
    // because new items will have all new children, so checking them is redundant
    treeItem.options.children.forEach((child) => {
      getItemsById(child, exclude, itemsById);
    });
  }
  return itemsById;
};

const updateSegmentIds = (item, filename) => {
  if (item.type === "Segment") {
    if (!item?.arguments?.[0]?.id) {
      console.log("in updateSegmentIds, item.arguments[0].id is undefined:");
      console.log(item);
      return;
    }
    item.arguments[0].id = `${filename}-${item.arguments[0].id}`;
  } else if (item?.options?.children) {
    item.options.children.forEach((child) => updateSegmentIds(child, filename));
  }
};

const filterOldPropagatedSegments = (item, filename) => {
  if (Array.isArray(item)) {
    const filtered = [];
    item.forEach((child) => {
      child = filterOldPropagatedSegments(child, filename);
      if (child !== null) {
        filtered.push(child);
      }
    });
    return filtered;
  } else if (item?.options?.children?.length > 0) {
    if (item.type === "PeaksGroup") {
      item.options.children = item.options.children.filter((child) => {
        if (!child?.arguments?.[0]?.id) {
          // if the last commit was from processing the file, the segments won't
          // have ids (and are therefore not propagated segments)
          return true;
        }
        return !child.arguments[0].id.startsWith(`${filename}-`);
      });
    } else {
      item.options.children = filterOldPropagatedSegments(
        item.options.children,
        filename
      );
    }
    return item.options.children.length === 0 ? null : item;
  }
};

const setParents = (treeItem, parent = null) => {
  // Top-level items have options.parent but any other items don't, so this sets
  // the parent for all items. It's set directly on the item instead of in options
  // because items might not have options
  treeItem.parent = parent;
  if (treeItem?.options?.children) {
    treeItem?.options?.children.forEach((child) => {
      setParents(child, treeItem);
    });
  }
};

/**
 * @param {![number, number]} interval1
 * @param {![number, number]} interval2
 * @returns {boolean} - Whether the two intervals overlap.
 */
const isOverlapping = ([start1, end1], [start2, end2]) => {
  if (start1 <= start2 && start2 <= end1) {
    return true; // interval2 starts within interval1
  }
  // true if interval1 starts within interval2
  return start2 <= start1 && start1 <= end2;
};

/**
 * Returns a group containing only the segments that overlap the specified interval.
 * `group` is modified in place.
 * @param {!Object<string, any>} group
 * @param {!Object<string, any>} fileItemsById
 * @param {![number, number]} interval
 */
const getGroupOverlapping = (group, fileItemsById, interval) => {
  group.options = group.options ?? {};
  group.options.children = group.options.children ?? [];
  if (group.type === "PeaksGroup") {
    group.options.children = group.options.children.filter((segment) => {
      if (segment.arguments === undefined) {
        console.log("in getGroupOverlapping, segment.arguments is undefined:");
        console.log(segment);
        return false;
      }
      const segmentArgs = segment.arguments[0];
      const segmentInterval = [segmentArgs.startTime, segmentArgs.endTime];
      return isOverlapping(interval, segmentInterval);
    });
  } else if (group.type === "Group") {
    const newChildren = [];
    group.options.children.forEach((child) => {
      child = getGroupOverlapping(child, fileItemsById, interval);
      if (child.options.children.length > 0) {
        newChildren.push(child);
      }
    });
    group.options.children = newChildren;
  }
  return group;
};

const adjustSegmentTimes = (group, interval) => {
  if (group.type === "PeaksGroup") {
    const startOffset = interval[0];
    const end = interval[1] - startOffset;
    group.options.children.forEach((segment) => {
      if (segment.arguments === undefined) {
        console.log("in adjustSegmentTimes, segment.arguments is undefined:");
        console.log(segment);
        return;
      }
      const segmentProps = segment.arguments[0];
      segmentProps.startTime -= startOffset;
      segmentProps.endTime -= startOffset;
      if (segmentProps.startTime < 0) {
        segmentProps.startTime = 0;
      }
      if (segmentProps.endTime > end) {
        segmentProps.endTime = end;
      }
    });
  } else if (group?.options?.children) {
    group.options.children.forEach((child) => {
      adjustSegmentTimes(child, interval);
    });
  }
};

const getPath = (item) => {
  if (item.parent) {
    if (item.parent.arguments === undefined) {
      console.log("in getPath, item.parent.arguments is undefined:");
      console.log(item.parent);
      return [[], {}];
    }
    const id = item.parent.arguments[0];
    const [pathIds, pathById] = getPath(item.parent, path);
    pathIds.push(id);
    pathById[id] = item.parent;
    return [pathIds, pathById];
  } else {
    return [[], {}];
  }
};

const getFilePieces = async (filename) => {
  const annotsFolder = path.join(dataDir, "annotations", filename);
  const timesFile = path.join(dataDir, "views", `${filename}-times.csv`);

  const results = await parseCsv(fs.createReadStream(timesFile), {
    dynamicTyping: true, // converts strings to numbers if possible
    skipEmptyLines: true, // ignore the empty line at the end of the file
  });
  // Remove header row. We don't pass header: true to parseCsv because the column
  // names are not what we want to use as the keys
  results.data.shift();
  const filePieces = results.data.map((row) => {
    const [filePiece, startTime, endTime] = row;
    // filePiece is something like "example.wav" so parse to get the name without .wav
    const pieceFilename = `${path.parse(filePiece).name}-annotations.json`;
    return {
      file: path.join(annotsFolder, pieceFilename),
      interval: [startTime, endTime],
    };
  });
  return filePieces;
};

const mergeInto = (item, other) => {
  other.options.children = other.options.children ?? [];
  if (item.type === "PeaksGroup") {
    other.options.children.push(...item.options.children);
  } else if (item?.options?.children && other?.options) {
    item.options.children.forEach((itemChild) => {
      if (itemChild.arguments === undefined) {
        console.log("in mergeInto, itemChild.arguments is undefined:");
        console.log(itemChild);
        return;
      }
      const otherChild = other.options.children.find((otherChild) => {
        if (otherChild.arguments === undefined) {
          console.log("in mergeInto, otherChild.arguments is undefined:");
          console.log(otherChild);
          return;
        }
        return otherChild.arguments[0] === itemChild.arguments[0];
      });
      if (otherChild) {
        mergeInto(itemChild, otherChild);
      } else {
        other.options.children.push(itemChild);
      }
    });
  }
};

const propagate = async (file, annotations, { user, branch, message } = {}) => {
  const annotsFilename = file.replace("-annotations.json", "");
  const annotsFile = path.join(dataDir, "annotations", file);

  const filePieces = await getFilePieces(annotsFilename);

  // get the last annotations so we can compare them to the new ones
  const oldestVersion = await fossil.oldestVersion(annotsFile, { branch });
  const oldAnnotations = JSON.parse(
    await fossilUtil.catAnnotations(annotsFile, {
      commit: oldestVersion.commit,
    })
  );
  // handle formatVersion 2 and 3 (see format-specification.md)
  const oldAnnots = oldAnnotations?.annotations ?? oldAnnotations;
  const oldItemsById = {};
  oldAnnots.forEach((item) => getItemsById(item, undefined, oldItemsById));
  // Special case for Words because they might not be in the initial annotations, and
  // we know we don't want to propagate them if they're new.
  oldItemsById.Words = { arguments: ["Words"] };

  // Annotations is object with keys "formatVersion", "annotations", etc.
  // Don't need to handle format versions because client always sends latest version (3)
  const annots = annotations.annotations;
  // we need to set the parent of every item so we can get the paths when propagating
  setParents(annots);
  // update segment ids to include the filename so we can distinguish them from
  // segments in the individual files
  annots.forEach((item) => updateSegmentIds(item, annotsFilename));
  // newItemsById has all new items beyond the initial items created by the pipeline
  const newItemsById = {};
  annots.forEach((item) => getItemsById(item, oldItemsById, newItemsById));
  // filter out new segments (e.g., segments added to an existing group like Speaker 1)
  // because the group to propagate them to is unclear
  const newGroups = Object.values(newItemsById).filter(
    (item) => item.type !== "Segment"
  );

  // for of instead of forEach because we need to use await
  const files = [];
  for (const { file, interval } of filePieces) {
    let fileAnnotations = JSON.parse(
      await fossilUtil.catAnnotations(file, { branch })
    );
    let fileAnnots = fileAnnotations?.annotations ?? fileAnnotations;
    // filter out old segments that were propagated to avoid duplicates and id conflicts
    fileAnnots = filterOldPropagatedSegments(fileAnnots, annotsFilename);
    const fileItemsById = {};
    fileAnnots.forEach((item) => getItemsById(item, undefined, fileItemsById));

    // create a copy of newGroups because getGroupOverlapping modifies groups in place
    const newGroupsCopy = JSON.parse(JSON.stringify(newGroups));
    const groupsOverlapping = newGroupsCopy
      .map((group) => {
        return getGroupOverlapping(group, fileItemsById, interval);
      })
      .filter((group) => group.options.children.length > 0);

    let hasOverlapping = false;
    for (const group of groupsOverlapping) {
      if (group.options.children.length === 0) {
        continue; // no overlapping segments from group, so nothing to propagate
      }

      files.push(file);
      hasOverlapping = true;

      adjustSegmentTimes(group, interval);
      const [pathIds, pathById] = getPath(group);
      // default to fileAnnots because if the group has no parent
      // (i.e., path.length === 0), we need to add it to the top-level
      let parentChildren = fileAnnots;
      while (pathIds.length > 0) {
        const id = pathIds.shift();
        if (!fileItemsById[id]) {
          // the group's ancestor isn't in the file, so we need to add it
          const ancestor = pathById[id];
          ancestor.options.children = [];
          // remove parent because it's not part of the format (because it's redundant)
          delete ancestor.parent;
          parentChildren.push(ancestor);
          // fileItemsById[id] = ancestor;
        }
        parentChildren = fileItemsById[id].options.children;
      }

      const index = parentChildren.findIndex((child) => {
        if (child.arguments === undefined) {
          console.log("in propagate, child.arguments is undefined:");
          console.log(child);
          return false;
        }
        return child.arguments[0] === group.arguments[0];
      });
      if (index === -1) {
        parentChildren.push(group);
      } else {
        mergeInto(group, parentChildren[index]);
      }
    }

    if (hasOverlapping) {
      if (fileAnnotations?.formatVersion) {
        fileAnnotations.annotations = fileAnnots;
      } else {
        fileAnnotations = {
          formatVersion: 3,
          annotations: fileAnnots,
        };
      }

      const json = JSON.stringify(fileAnnotations, null, "  ");
      // don't commit because we will commit all files at once after propagating
      await write(file, json);
    }
  }
  if (files.length === 0) {
    return;
  }
  const propagateMessage = `Propagating ${annotsFilename} - ${message}`;
  const propagateOptions = { user, branch, message: propagateMessage };
  await fossil.commit(files, propagateOptions);
};

module.exports = propagate;
