const Type = class Type {
  /**
   * Creates a `Type` from the type info of a value.
   * @static
   * @param {any} value - The value to get the type info from.
   * @returns {Type} The type info of the value.
   * @throws {Error} If the value is `null`.
   */
  static fromValue(value) {
    if (typeof value === "number" || typeof value === "bigint") {
      return new Type("number");
    } else if (typeof value === "string") {
      return new Type("string");
    } else if (typeof value === "boolean") {
      return new Type("boolean");
    } else if (Array.isArray(value)) {
      return new Type("array", Type.fromValue(value[0]));
    } else if (typeof value === "object") {
      if (value === null) {
        throw new Error("value is null");
      }
      return new Type("object", Type.fromValue(Object.values(value)[0]));
    }
  }

  /**
   * The type of the value.
   * @type {string}
   */
  type;
  /**
   * If the type is "array" or "object", this is the type of the value of the
   * elements / values. Otherwise, `null`.
   * @type {?Type}
   */
  innerType;

  /**
   * @param {string} type - The type of the value.
   * @param {?Type} innerType - The type of the value of the elements / values if
   *    the type is "array" or "object". Otherwise, `null`.
   */
  constructor(type, innerType = null) {
    this.type = type;
    this.innerType = innerType;
  }

  equals(other) {
    if (other === null) {
      return false;
    } else if (this.type !== other.type) {
      return false;
    } else if (this.innerType === null) {
      return other.innerType === null;
    }
    return this.innerType.equals(other.innerType);
  }
};

/** A class to store type information about an attribute. */
const Attribute = class Attribute {
  /**
   * The name of the attribute.
   * @type {string}
   */
  name;
  /**
   * The type of the value of the attribute.
   * @type {Type}
   */
  type;
  /**
   * The type of TreeItem that added the attribute.
   * @type {string}
   */
  treeItemType;

  /**
   * @param {string} name - The name of the attribute.
   * @param {Type} type - The type of the value of the attribute.
   * @param {string} treeItemType - The type of TreeItem that added the attribute.
   */
  constructor(name, value, treeItemType) {
    this.name = name;
    this.type = Type.fromValue(value);
    this.treeItemType = treeItemType;
  }

  equals(other) {
    return (
      this.name === other.name &&
      this.type.equals(other.type) &&
      this.treeItemType === other.treeItemType
    );
  }
};

/**
 * A map of attribute names to `Attribute`s.
 * Used to store all attributes that have been added to `TreeItem`s.
 * @type {Object.<string, Attribute>}
 */
const Attributes = {};

export { Type, Attribute, Attributes };
