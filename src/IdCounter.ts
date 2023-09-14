const replacedRegex = /%d/;

/**
 * IdCounter is a class that generates unique ids based on a template.
 */
const IdCounter = class {
  /**
   * The next number to use for an id.
   * @type {number}
   */
  #id;

  /**
   * The template to use for generating ids.
   * @type {string}
   */
  #template;

  /**
   * The regex used to parse numbers from ids.
   * @type {RegExp}
   */
  #templateRegex;

  /**
   * @param {string} template - The template to use for generating ids. It should
   *    contain a "%d" where the id number should be inserted.
   * @param {number} [start=0] - The number to start counting ids from. Must be
   *    greater than or equal to 0.
   * @throws {Error} If `start is less than 0.
   */
  constructor(template, start = 0) {
    if (start < 0) {
      throw new Error("start must be greater than or equal to 0");
    }
    this.#id = start;
    this.#template = template;
    this.#templateRegex = new RegExp(template.replace(replacedRegex, "(\\d+)"));
  }

  /**
   * @returns {string} The next id.
   */
  next() {
    return this.#template.replace(replacedRegex, this.#id++);
  }

  /**
   * Updates the counter based on the given id.
   *
   * If the id contains a number greater than the current id, the current id
   * will be updated to the number in the id plus one. If the id wasn't generated
   * by this counter, it will be ignored.
   * @param {string} id - The id to update the counter with.
   */
  update(id) {
    const match = this.#templateRegex.exec(id);
    if (match) {
      const idNumber = parseInt(match[1]);
      if (idNumber >= this.#id) {
        this.#id = idNumber + 1;
      }
    }
  }
};

export default IdCounter;
