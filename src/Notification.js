import { htmlToElement } from "./util.js";
import { notifIcons } from "./icon.js";

const Notification = class Notification {
  /**
   * @type {!HTMLDivElement}
   */
  div;

  /**
   * @type {!SVGElement}
   */
  icon;

  /**
   * @type {!HTMLSpanElement}
   */
  messageSpan;

  /**
   * @type {!HTMLAnchorElement}
   */
  closeButton;

  #timeoutID = null;

  constructor() {
    this.div = htmlToElement(`<div class="notification"></div>`);
    this.icon = htmlToElement(notifIcons.info); // default icon
    this.messageSpan = htmlToElement(
      `<span class="notification-message"></span>`
    );
    this.closeButton = htmlToElement(
      `<a href="javascript:;" class="icon notification-close">${notifIcons.x}</a>`
    );
    this.closeButton.addEventListener("click", () => this.hide());
    this.div.append(this.icon, this.messageSpan, this.closeButton);
    document.body.append(this.div);
  }

  /**
   * @param {string} message
   * @param {"alert"|"info"} [type="info"] - "alert" or "info"
   * @param {?Object.<string, any>=} options
   * @param {number} [options.timeout=3] - Timeout in seconds.
   */
  show(message, type = "info", { timeout = 3 } = {}) {
    if (this.#timeoutID !== null) {
      clearTimeout(this.#timeoutID);
      this.#timeoutID = null;
    }
    this.messageSpan.innerHTML = message;
    if (notifIcons[type] === undefined) {
      type = "info";
    }
    this.icon.outerHTML = notifIcons[type];
    this.div.style.display = "flex";
    if (timeout) {
      this.#timeoutID = setTimeout(() => {
        this.#timeoutID = null;
        this.hide();
      }, timeout * 1000);
    }
  }

  hide() {
    this.div.style.display = "none";
  }
};

const notification = new Notification();
export { notification };
